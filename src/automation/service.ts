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

export type RunSource = "worker" | "cron" | "page";
const LEASE_SECONDS = 120;

/** Takes the company for one pass. False when another runner holds it. The lease expires on its own if a runner dies. */
export async function claimRun(pool: Pool, tenantId: string, minAgeSeconds = 0): Promise<boolean> {
  return withTenant(pool, tenantId, async (c) => {
    await c.query(`insert into autonomy_run (tenant_id) values ($1) on conflict do nothing`, [tenantId]);
    const r = await c.query(`update autonomy_run set locked_until = now() + ($2 || ' seconds')::interval where tenant_id = $1 and (locked_until is null or locked_until < now()) and (last_run_at is null or last_run_at <= now() - ($3 || ' seconds')::interval)`, [tenantId, String(LEASE_SECONDS), String(minAgeSeconds)]);
    return (r.rowCount ?? 0) > 0;
  });
}
async function finishRun(pool: Pool, tenantId: string, source: RunSource, report: object) {
  await withTenant(pool, tenantId, (c) => c.query(`update autonomy_run set locked_until = null, last_run_at = now(), last_source = $2, last_report = $3, runs = runs + 1 where tenant_id = $1`, [tenantId, source, JSON.stringify(report)]));
}

type OnePass = { closed: number; reminders: number; extended: number; nudged: number; emailed: number; failed: number };

/** One pass for one company. Null when another runner holds it (or, with minAgeSeconds, ran too recently). */
export async function passFor(pool: Pool, t: string, send: Parameters<typeof flushOutbox>[2] | undefined, source: RunSource, minAgeSeconds = 0): Promise<OnePass | null> {
  if (!(await claimRun(pool, t, minAgeSeconds))) return null;
  try {
    const one: OnePass = { closed: 0, reminders: 0, extended: 0, nudged: 0, emailed: 0, failed: 0 };
    one.extended = await extendDeadlines(pool, t);   // before closing, so an extended event is not closed in the same run
    one.closed = await autoClose(pool, t);
    one.reminders = await sendReminders(pool, t);
    one.nudged = await nudgeApprovers(pool, t);
    const o = await flushOutbox(pool, t, send); one.emailed = o.sent; one.failed = o.failed;
    await finishRun(pool, t, source, one);
    return one;
  } catch (e) {
    await withTenant(pool, t, (c) => c.query(`update autonomy_run set locked_until = null where tenant_id = $1`, [t])).catch(() => undefined);
    throw e;
  }
}

/** One pass over every organisation. Safe to run as often as you like, and by more than one runner: a company already being worked on is skipped. */
export async function tick(pool: Pool, send?: Parameters<typeof flushOutbox>[2], source: RunSource = "cron"): Promise<TickReport> {
  const tenants = (await pool.query(`select id from tenant`)).rows.map((r) => r.id as string);
  const rep: TickReport = { tenants: tenants.length, closed: 0, reminders: 0, extended: 0, nudged: 0, emailed: 0, failed: 0 };
  for (const t of tenants) {
    try {
      const one = await passFor(pool, t, send, source);
      if (one) for (const k of Object.keys(one) as (keyof OnePass)[]) rep[k] += one[k];
    } catch (e) { console.error("tick failed for a tenant", e instanceof Error ? e.message : e); rep.failed++; }
  }
  return rep;
}

const lastTry = new Map<string, number>();
export const PAGE_TICK_SECONDS = 60;
/**
 * The backup clock: called after a signed-in page is sent. Runs a pass for that company only if the last one was over a minute ago.
 * A cheap in-memory check keeps most page views from touching the database at all. Never throws and never delays the page.
 */
export async function pageTick(pool: Pool, tenantId: string, now = Date.now()): Promise<boolean> {
  if (now - (lastTry.get(tenantId) ?? 0) < PAGE_TICK_SECONDS * 1000) return false;
  lastTry.set(tenantId, now);
  try { return (await passFor(pool, tenantId, undefined, "page", PAGE_TICK_SECONDS)) !== null; } catch (e) { console.error("page tick failed", e instanceof Error ? e.message : e); return false; }
}
export const resetPageTick = () => lastTry.clear();

/**
 * The internal clock: runs a pass every `intervalMs` until `signal` aborts. A failed pass is logged and the clock keeps going.
 * Meant for a small always-on process (scripts/worker.ts); a serverless host cannot keep one alive.
 */
export async function runLoop(pool: Pool, opts: { intervalMs: number; signal: AbortSignal; pass?: typeof tick; log?: (line: string) => void }): Promise<number> {
  const pass = opts.pass ?? tick, log = opts.log ?? ((l) => console.log(l));
  let n = 0;
  while (!opts.signal.aborted) {
    const started = Date.now();
    try {
      const r = await pass(pool, undefined, "worker"); n++;
      if (r.closed || r.reminders || r.extended || r.nudged || r.emailed || r.failed) log(`[worker] closed ${r.closed}, extended ${r.extended}, reminders ${r.reminders}, nudges ${r.nudged}, emailed ${r.emailed}, failed ${r.failed}`);
    } catch (e) { log(`[worker] pass failed: ${e instanceof Error ? e.message : "unknown"}`); }
    const wait = Math.max(0, opts.intervalMs - (Date.now() - started));
    await new Promise<void>((res) => { const t = setTimeout(res, wait); opts.signal.addEventListener("abort", () => { clearTimeout(t); res(); }, { once: true }); });
  }
  return n;
}

import type { LastRun } from "./policy-types";
export type { LastRun };
export async function lastRun(pool: Pool, tenantId: string): Promise<LastRun | null> {
  return withTenant(pool, tenantId, async (c) => {
    const r = (await c.query(`select last_run_at, last_source, last_report from autonomy_run where last_run_at is not null`)).rows[0];
    if (!r) return null;
    const rep = (r.last_report ?? {}) as Record<string, number>;
    return { at: new Date(r.last_run_at).toISOString(), source: r.last_source, closed: rep.closed ?? 0, reminders: rep.reminders ?? 0, extended: rep.extended ?? 0, nudged: rep.nudged ?? 0, emailed: rep.emailed ?? 0 };
  });
}
