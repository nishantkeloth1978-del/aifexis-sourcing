import type { Pool } from "pg";
import { applyTransition, withTenant } from "@/authz";
import { notify } from "@/notifications/hooks";
import { sendMail, type SendResult } from "./mailer";

export interface TickReport { tenants: number; closed: number; reminders: number; emailed: number; failed: number }
export const REMINDER_HOURS = 24;

/** Closes events whose closing time has passed. Runs as the system, so the normal lifecycle rules and audit trail apply. */
export async function autoClose(pool: Pool, tenantId: string): Promise<number> {
  return withTenant(pool, tenantId, async (c) => {
    const due = (await c.query(`select id, state_version from sourcing_event where state = 'published' and closes_at is not null and closes_at <= now() order by closes_at limit 50`)).rows;
    let n = 0;
    for (const e of due) {
      await c.query("savepoint ac");
      const r = await applyTransition(c, { kind: "system", tenantId }, e.id, "CloseEvent", { expectedVersion: e.state_version });
      if (r.ok) { n++; await c.query("release savepoint ac"); } else await c.query("rollback to savepoint ac");
      if (r.ok) {
        const ref = (await c.query(`select ref from sourcing_event where id = $1`, [e.id])).rows[0]?.ref;
        const buyers = (await c.query(`select m.user_id from event_member em join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id where em.event_id = $1 and em.event_role = 'buyer'`, [e.id])).rows.map((x) => x.user_id as string);
        await notify(c, tenantId, buyers, e.id, "auto_closed", `${ref} reached its closing time and was closed. The technical envelopes can now be opened.`);
      }
    }
    return n;
  });
}

/** One reminder per supplier per event: invited, not yet bid, closing within the next day. */
export async function sendReminders(pool: Pool, tenantId: string, hours = REMINDER_HOURS): Promise<number> {
  return withTenant(pool, tenantId, async (c) => {
    const rows = (await c.query(
      `select distinct e.id as event_id, e.ref, e.closes_at, i.supplier_id, su.user_id
         from sourcing_event e
         join invitation i on i.tenant_id = e.tenant_id and i.event_id = e.id
         join supplier_user su on su.tenant_id = i.tenant_id and su.supplier_id = i.supplier_id
        where e.state = 'published' and e.closes_at > now() and e.closes_at <= now() + ($1 || ' hours')::interval
          and not exists (select 1 from bid_revision b where b.event_id = e.id and b.supplier_id = i.supplier_id)
          and not exists (select 1 from reminder_log r where r.event_id = e.id and r.supplier_id = i.supplier_id and r.kind = 'closing_soon')`, [String(hours)])).rows;
    let n = 0;
    for (const r of rows) {
      const ins = await c.query(`insert into reminder_log (tenant_id, event_id, supplier_id, kind) values ($1,$2,$3,'closing_soon') on conflict do nothing`, [tenantId, r.event_id, r.supplier_id]);
      if (!ins.rowCount) continue;
      const when = new Date(r.closes_at).toISOString().replace("T", " ").slice(0, 16) + " UTC";
      await notify(c, tenantId, [r.user_id], r.event_id, "closing_soon", `${r.ref} closes on ${when} and you have not submitted a bid yet.`);
      n++;
    }
    return n;
  });
}

/** Sends queued e-mails. A failed one is retried on the next run, up to 5 attempts. */
export async function flushOutbox(pool: Pool, tenantId: string, send: (to: string, s: string, b: string) => Promise<SendResult> = sendMail): Promise<{ sent: number; failed: number }> {
  return withTenant(pool, tenantId, async (c) => {
    const rows = (await c.query(`select id, to_email, subject, body from email_outbox where status = 'pending' and attempts < 5 order by id limit 50 for update skip locked`)).rows;
    let sent = 0, failed = 0;
    for (const m of rows) {
      const r = await send(m.to_email, m.subject, m.body);
      if (r.ok) { sent++; await c.query(`update email_outbox set status = $2, attempts = attempts + 1, sent_at = now(), last_error = null where id = $1`, [m.id, r.mode]); }
      else { failed++; await c.query(`update email_outbox set attempts = attempts + 1, last_error = $2, status = case when attempts + 1 >= 5 then 'failed' else 'pending' end where id = $1`, [m.id, r.error]); }
    }
    return { sent, failed };
  });
}

/** One pass over every organisation. Safe to run as often as you like. */
export async function tick(pool: Pool, send?: Parameters<typeof flushOutbox>[2]): Promise<TickReport> {
  const tenants = (await pool.query(`select id from tenant`)).rows.map((r) => r.id as string);
  const rep: TickReport = { tenants: tenants.length, closed: 0, reminders: 0, emailed: 0, failed: 0 };
  for (const t of tenants) {
    try {
      rep.closed += await autoClose(pool, t);
      rep.reminders += await sendReminders(pool, t);
      const o = await flushOutbox(pool, t, send); rep.emailed += o.sent; rep.failed += o.failed;
    } catch (e) { console.error("tick failed for a tenant", e instanceof Error ? e.message : e); rep.failed++; }
  }
  return rep;
}
