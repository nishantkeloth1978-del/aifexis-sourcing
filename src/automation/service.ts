import type { Pool } from "pg";
import { applyTransition, withTenant } from "@/authz";
import { audit } from "@/authz/service";
import { policyOf } from "./policy";
import { notify } from "@/notifications/hooks";
import { sendMail, type SendResult } from "./mailer";

export interface TickReport { tenants: number; closed: number; reminders: number; extended: number; nudged: number; emailed: number; failed: number }
const SYSTEM = (tenantId: string) => ({ kind: "system" as const, tenantId });
const kindFor = (days: number) => (days === 1 ? "closing_soon" : `closing_${days}d`);

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
        await audit(c, SYSTEM(tenantId), e.id, "autonomy.auto_close", { text: "Closed automatically at the closing time" });
        const ref = (await c.query(`select ref from sourcing_event where id = $1`, [e.id])).rows[0]?.ref;
        const buyers = (await c.query(`select m.user_id from event_member em join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id where em.event_id = $1 and em.event_role = 'buyer'`, [e.id])).rows.map((x) => x.user_id as string);
        await notify(c, tenantId, buyers, e.id, "auto_closed", `${ref} reached its closing time and was closed. The technical envelopes can now be opened.`);
      }
    }
    return n;
  });
}

/**
 * Reminders to invited suppliers who have not bid, at the days before closing the company chose (default: one, a day before).
 * A supplier gets one message per run: the smallest reminder day that now applies. Larger days that already passed are recorded, not sent.
 * Paused companies get none.
 */
export async function sendReminders(pool: Pool, tenantId: string): Promise<number> {
  return withTenant(pool, tenantId, async (c) => {
    const pol = await policyOf(c);
    if (pol.paused || !pol.reminderDays.length) return 0;
    const widest = Math.max(...pol.reminderDays);
    const rows = (await c.query(
      `select distinct e.id as event_id, e.ref, e.closes_at, i.supplier_id, su.user_id
         from sourcing_event e
         join invitation i on i.tenant_id = e.tenant_id and i.event_id = e.id
         join supplier_user su on su.tenant_id = i.tenant_id and su.supplier_id = i.supplier_id
        where e.state = 'published' and e.closes_at > now() and e.closes_at <= now() + ($1 || ' days')::interval
          and not exists (select 1 from bid_revision b where b.event_id = e.id and b.supplier_id = i.supplier_id)`, [String(widest)])).rows;
    let n = 0;
    const perEvent = new Map<string, { ref: string; n: number }>();
    for (const r of rows) {
      const ms = new Date(r.closes_at).getTime() - Date.now();
      const due = pol.reminderDays.filter((d) => ms <= d * 86_400_000);
      if (!due.length) continue;
      const smallest = Math.min(...due);
      const logged = new Set((await c.query(`select kind from reminder_log where event_id = $1 and supplier_id = $2`, [r.event_id, r.supplier_id])).rows.map((x) => x.kind as string));
      const fresh = due.filter((d) => !logged.has(kindFor(d)));
      if (!fresh.length) continue;
      let inserted = false;
      for (const d of fresh) { const ins = await c.query(`insert into reminder_log (tenant_id, event_id, supplier_id, kind) values ($1,$2,$3,$4) on conflict do nothing`, [tenantId, r.event_id, r.supplier_id, kindFor(d)]); if (ins.rowCount && d === smallest) inserted = true; }
      if (!inserted) continue;   // only a larger day was new: recorded, not sent
      const when = new Date(r.closes_at).toISOString().replace("T", " ").slice(0, 16) + " UTC";
      const left = Math.max(1, Math.ceil(ms / 86_400_000));
      await notify(c, tenantId, [r.user_id], r.event_id, "closing_soon", smallest === 1 ? `${r.ref} closes on ${when} and you have not submitted a bid yet.` : `${r.ref} closes on ${when}, in ${left} days, and you have not submitted a bid yet.`);
      n++;
      const e = perEvent.get(r.event_id) ?? { ref: r.ref, n: 0 }; e.n++; perEvent.set(r.event_id, e);
    }
    for (const [id, e] of perEvent) await audit(c, SYSTEM(tenantId), id, "autonomy.auto_remind", { text: `Reminded ${e.n} supplier${e.n === 1 ? "" : "s"} who had not bid.` });
    return n;
  });
}

/**
 * One automatic extension, only when the company allows it, only for an event about to close with fewer bidding suppliers than the company's
 * minimum, and never twice. Invited suppliers and the buyers are told the new closing time.
 */
export async function extendDeadlines(pool: Pool, tenantId: string): Promise<number> {
  return withTenant(pool, tenantId, async (c) => {
    const pol = await policyOf(c);
    if (pol.paused || !pol.extendEnabled) return 0;
    const due = (await c.query(
      `select e.id, e.ref, e.closes_at, (select count(distinct b.supplier_id) from bid_revision b where b.event_id = e.id)::int as bidders
         from sourcing_event e where e.state = 'published' and e.auto_extended_at is null and e.closes_at > now() and e.closes_at <= now() + interval '24 hours' limit 50`)).rows;
    let n = 0;
    for (const e of due) {
      if (e.bidders >= pol.extendMinBids) continue;
      const upd = await c.query(`update sourcing_event set closes_at = closes_at + ($2 || ' hours')::interval, auto_extended_at = now() where id = $1 and state = 'published' and auto_extended_at is null returning closes_at`, [e.id, String(pol.extendHours)]);
      if (!upd.rowCount) continue;
      n++;
      const when = new Date(upd.rows[0].closes_at).toISOString().replace("T", " ").slice(0, 16) + " UTC";
      const suppliers = (await c.query(`select distinct su.user_id from invitation i join supplier_user su on su.tenant_id = i.tenant_id and su.supplier_id = i.supplier_id where i.event_id = $1`, [e.id])).rows.map((x) => x.user_id as string);
      const buyers = (await c.query(`select m.user_id from event_member em join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id where em.event_id = $1 and em.event_role = 'buyer'`, [e.id])).rows.map((x) => x.user_id as string);
      await notify(c, tenantId, suppliers, e.id, "deadline_extended", `${e.ref} now closes on ${when}. The deadline was extended once.`);
      await notify(c, tenantId, buyers, e.id, "deadline_extended", `${e.ref} had ${e.bidders} bidding supplier${e.bidders === 1 ? "" : "s"}, below your minimum of ${pol.extendMinBids}, so it was extended once to ${when}.`);
      await audit(c, SYSTEM(tenantId), e.id, "autonomy.auto_extend", { text: `Extended once by ${pol.extendHours} hours to ${when}: ${e.bidders} bidding, minimum ${pol.extendMinBids}.` });
    }
    return n;
  });
}

/** A reminder to approvers who have not decided on an event that has waited longer than the company's limit. At most one per approver per limit period. */
export async function nudgeApprovers(pool: Pool, tenantId: string): Promise<number> {
  return withTenant(pool, tenantId, async (c) => {
    const pol = await policyOf(c);
    if (pol.paused || pol.nudgeHours <= 0) return 0;
    const rows = (await c.query(
      `select e.id as event_id, e.ref, case e.state when 'pending_publication' then 'publication' else 'award' end as step, m.user_id, em.membership_id
         from sourcing_event e
         join event_member em on em.tenant_id = e.tenant_id and em.event_id = e.id
           and em.event_role = case e.state when 'pending_publication' then 'publication_approver' else 'award_approver' end
         join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id
        where e.state in ('pending_publication', 'pending_award')
          and (select max(a.at) from audit_event a where a.event_id = e.id and a.action not like 'autonomy.%') <= now() - ($1 || ' hours')::interval
          and not exists (select 1 from approval ap where ap.event_id = e.id and ap.approver_membership_id = em.membership_id and ap.step = case e.state when 'pending_publication' then 'publication' else 'award' end)
          and not exists (select 1 from audit_event n where n.event_id = e.id and n.action = 'autonomy.auto_nudge' and n.detail->>'membership' = em.membership_id::text and n.at > now() - ($1 || ' hours')::interval)
        limit 100`, [String(pol.nudgeHours)])).rows;
    let n = 0;
    for (const r of rows) {
      await notify(c, tenantId, [r.user_id], r.event_id, "approval_nudge", `${r.ref} is waiting for your ${r.step} decision.`);
      await audit(c, SYSTEM(tenantId), r.event_id, "autonomy.auto_nudge", { text: `Reminded an approver to decide on ${r.step}.`, membership: r.membership_id });
      n++;
    }
    return n;
  });
}

/** Sends queued e-mails. A failed one is retried on the next run, up to 5 attempts. */
export async function flushOutbox(pool: Pool, tenantId: string, send: (to: string, s: string, b: string, replyTo?: string | null) => Promise<SendResult> = (to, s, b, r) => sendMail(to, s, b, fetch, r)): Promise<{ sent: number; failed: number }> {
  return withTenant(pool, tenantId, async (c) => {
    const rows = (await c.query(`select id, to_email, subject, body, reply_to from email_outbox where status = 'pending' and attempts < 5 order by id limit 50 for update skip locked`)).rows;
    let sent = 0, failed = 0;
    for (const m of rows) {
      const r = await send(m.to_email, m.subject, m.body, m.reply_to);
      if (r.ok) { sent++; await c.query(`update email_outbox set status = $2, attempts = attempts + 1, sent_at = now(), last_error = null where id = $1`, [m.id, r.mode]); }
      else { failed++; await c.query(`update email_outbox set attempts = attempts + 1, last_error = $2, status = case when attempts + 1 >= 5 then 'failed' else 'pending' end where id = $1`, [m.id, r.error]); }
    }
    return { sent, failed };
  });
}

/** One pass over every organisation. Safe to run as often as you like. */
export async function tick(pool: Pool, send?: Parameters<typeof flushOutbox>[2]): Promise<TickReport> {
  const tenants = (await pool.query(`select id from tenant`)).rows.map((r) => r.id as string);
  const rep: TickReport = { tenants: tenants.length, closed: 0, reminders: 0, extended: 0, nudged: 0, emailed: 0, failed: 0 };
  for (const t of tenants) {
    try {
      rep.extended += await extendDeadlines(pool, t);   // before closing, so an extended event is not closed in the same run
      rep.closed += await autoClose(pool, t);
      rep.reminders += await sendReminders(pool, t);
      rep.nudged += await nudgeApprovers(pool, t);
      const o = await flushOutbox(pool, t, send); rep.emailed += o.sent; rep.failed += o.failed;
    } catch (e) { console.error("tick failed for a tenant", e instanceof Error ? e.message : e); rep.failed++; }
  }
  return rep;
}
