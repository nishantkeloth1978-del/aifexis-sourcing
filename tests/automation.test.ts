import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoClose, flushOutbox, sendReminders } from "@/automation/service";
import { sendMail } from "@/automation/mailer";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "auto"); });
afterAll(async () => { await pool.end(); await admin.end(); });

async function published(closesAtMs: number, invite = true) {
  const ev = (await admin.query(`insert into sourcing_event (tenant_id, title, state, ref, currency, closes_at) values ($1,'T','draft',$2,'AED',$3) returning id`,
    [X.tenantId, "EV-" + randomUUID().slice(0, 8), new Date(Date.now() + closesAtMs).toISOString()])).rows[0].id as string;
  await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit) values ($1,$2,1,'x',1,'ea')`, [X.tenantId, ev]);
  await admin.query(`update sourcing_event set state = 'published' where id = $1`, [ev]);
  await admin.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'buyer')`, [X.tenantId, ev, X.people.buyer.membershipId]);
  if (invite) await admin.query(`insert into invitation (tenant_id, event_id, supplier_id, supplier_user_id, token_hash) values ($1,$2,$3,$4,$5)`, [X.tenantId, ev, X.suppliers[0].id, X.suppliers[0].supplierUserId, randomUUID()]);
  return ev;
}
const stateOf = async (id: string) => (await admin.query(`select state::text s from sourcing_event where id = $1`, [id])).rows[0].s as string;

describe("automation", () => {
  it("closes events past their closing time, only those, and tells the buyer", async () => {
    const late = await published(-60_000, false), later = await published(3600_000 * 48, false);
    expect(await autoClose(pool, X.tenantId)).toBeGreaterThanOrEqual(1);
    expect(await stateOf(late)).toBe("closed"); expect(await stateOf(later)).toBe("published");
    const n = await admin.query(`select 1 from notification where event_id = $1 and kind = 'auto_closed'`, [late]);
    expect(n.rowCount).toBe(1);
    expect(await autoClose(pool, X.tenantId)).toBe(0);
    expect((await admin.query(`select 1 from audit_event where event_id = $1 and action like '%CloseEvent%'`, [late])).rowCount).toBeGreaterThan(0);
  });
  it("sends one reminder per supplier, skips those who already bid, and queues an e-mail", async () => {
    const soon = await published(3600_000 * 2);
    expect(await sendReminders(pool, X.tenantId)).toBeGreaterThanOrEqual(1);
    expect((await admin.query(`select 1 from notification where event_id = $1 and kind = 'closing_soon'`, [soon])).rowCount).toBe(1);
    expect((await admin.query(`select 1 from email_outbox where event_id = $1`, [soon])).rowCount).toBe(1);
    await sendReminders(pool, X.tenantId);
    expect((await admin.query(`select 1 from notification where event_id = $1 and kind = 'closing_soon'`, [soon])).rowCount).toBe(1);
    const bid = await published(3600_000 * 3);
    await admin.query(`insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key) values ($1,$2,$3,1,'k')`, [X.tenantId, bid, X.suppliers[0].id]);
    await sendReminders(pool, X.tenantId);
    expect((await admin.query(`select 1 from notification where event_id = $1 and kind = 'closing_soon'`, [bid])).rowCount).toBe(0);
  });
  it("flushes the outbox, retries failures and stops after 5 attempts", async () => {
    const sent: string[] = [];
    const r1 = await flushOutbox(pool, X.tenantId, async (to) => { sent.push(to); return { ok: true, mode: "logged" }; });
    expect(r1.sent).toBeGreaterThan(0); expect(sent[0]).toContain("@");
    await admin.query(`insert into email_outbox (tenant_id, to_email, subject, body) values ($1,'a@x.com','s','b')`, [X.tenantId]);
    for (let i = 0; i < 5; i++) await flushOutbox(pool, X.tenantId, async () => ({ ok: false, error: "down" }));
    const row = (await admin.query(`select status, attempts from email_outbox where to_email = 'a@x.com'`)).rows[0];
    expect(row).toMatchObject({ status: "failed", attempts: 5 });
    expect((await flushOutbox(pool, X.tenantId, async () => ({ ok: true, mode: "sent" }))).sent).toBe(0);
  });
  it("mailer only logs without credentials and calls Resend with them", async () => {
    delete process.env.RESEND_API_KEY; delete process.env.MAIL_FROM;
    expect(await sendMail("a@x.com", "s", "b")).toEqual({ ok: true, mode: "logged" });
    process.env.RESEND_API_KEY = "k"; process.env.MAIL_FROM = "Aifexis <n@x.com>";
    let seen: { url: string; auth: string | null } | undefined;
    const f = (async (url: string, init: RequestInit) => { seen = { url, auth: new Headers(init.headers).get("authorization") }; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    expect(await sendMail("a@x.com", "s", "b", f)).toEqual({ ok: true, mode: "sent" });
    expect(seen).toEqual({ url: "https://api.resend.com/emails", auth: "Bearer k" });
    expect(await sendMail("a@x.com", "s", "b", (async () => new Response("no", { status: 500 })) as unknown as typeof fetch)).toMatchObject({ ok: false });
    delete process.env.RESEND_API_KEY; delete process.env.MAIL_FROM;
  });
});

describe("autonomy policy and the automatic steps", () => {
  const who = (w: World, role: "admin" | "buyer") => ({ tenantId: w.tenantId, userId: w.people[role].userId, membershipId: w.people[role].membershipId, role: role === "admin" ? "admin" : "member", perms: role === "admin" ? ["config.manage"] : ["event.create"] }) as never;
  const policy = (patch: object = {}) => ({ paused: false, reminderDays: [1], extendEnabled: false, extendHours: 48, extendMinBids: 1, nudgeHours: 48, agentDailyLimit: 50, ...patch });
  it("validates and saves the policy, administrators only, and audits it", async () => {
    const { savePolicy, getPolicy, DEFAULT_POLICY } = await import("@/automation/policy");
    expect(await getPolicy(pool, X.tenantId)).toEqual(DEFAULT_POLICY);
    expect(await savePolicy(pool, who(X, "buyer"), policy())).toMatchObject({ ok: false });
    for (const bad of [{ reminderDays: [1, 1] }, { reminderDays: [8] }, { reminderDays: [1, 2, 3, 4, 5] }, { extendHours: 0 }, { extendHours: 169 }, { extendMinBids: 0 }, { nudgeHours: -1 }, { agentDailyLimit: 0 }, { agentDailyLimit: 1001 }, { nudgeHours: 1.5 }, { paused: "yes" }]) expect(await savePolicy(pool, who(X, "admin"), policy(bad)), JSON.stringify(bad)).toMatchObject({ ok: false });
    expect(await savePolicy(pool, who(X, "admin"), policy({ reminderDays: [1, 7, 3], extendEnabled: true }))).toMatchObject({ ok: true });
    expect((await getPolicy(pool, X.tenantId)).reminderDays).toEqual([7, 3, 1]);
    expect((await admin.query(`select 1 from audit_event where tenant_id = $1 and action = 'autonomy.policy'`, [X.tenantId])).rowCount).toBeGreaterThan(0);
    await savePolicy(pool, who(X, "admin"), policy());
  });
  it("sends the smallest applicable reminder once and records the larger days silently", async () => {
    const { savePolicy } = await import("@/automation/policy");
    await savePolicy(pool, who(X, "admin"), policy({ reminderDays: [7, 3, 1] }));
    const ev = await published(3600_000 * 60);   // 2.5 days left: the 7 and 3 day reminders apply, 3 is the smallest
    await sendReminders(pool, X.tenantId);
    const msgs = (await admin.query(`select message from notification where event_id = $1 and kind = 'closing_soon'`, [ev])).rows;
    expect(msgs).toHaveLength(1); expect(msgs[0].message).toContain("in 3 days");
    expect((await admin.query(`select kind from reminder_log where event_id = $1 order by kind`, [ev])).rows.map((r) => r.kind)).toEqual(["closing_3d", "closing_7d"]);
    await sendReminders(pool, X.tenantId);
    expect((await admin.query(`select 1 from notification where event_id = $1 and kind = 'closing_soon'`, [ev])).rowCount).toBe(1);
    await admin.query(`update sourcing_event set closes_at = now() + interval '5 hours' where id = $1`, [ev]);
    await sendReminders(pool, X.tenantId);   // now the 1 day reminder applies
    expect((await admin.query(`select 1 from notification where event_id = $1 and kind = 'closing_soon'`, [ev])).rowCount).toBe(2);
    await savePolicy(pool, who(X, "admin"), policy());
  });
  it("extends once, only when allowed and bids are below the minimum, and tells people", async () => {
    const { extendDeadlines } = await import("@/automation/service");
    const { savePolicy } = await import("@/automation/policy");
    const quiet = await published(3600_000 * 5), busy = await published(3600_000 * 5), far = await published(3600_000 * 72);
    await admin.query(`insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key) values ($1,$2,$3,1,'k2')`, [X.tenantId, busy, X.suppliers[0].id]);
    expect(await extendDeadlines(pool, X.tenantId)).toBe(0);   // off by default
    await savePolicy(pool, who(X, "admin"), policy({ extendEnabled: true, extendHours: 24, extendMinBids: 1 }));
    const before = (await admin.query(`select closes_at from sourcing_event where id = $1`, [quiet])).rows[0].closes_at as Date;
    expect(await extendDeadlines(pool, X.tenantId)).toBeGreaterThanOrEqual(1);
    const after = (await admin.query(`select closes_at, auto_extended_at from sourcing_event where id = $1`, [quiet])).rows[0];
    expect(new Date(after.closes_at).getTime() - new Date(before).getTime()).toBe(24 * 3600_000); expect(after.auto_extended_at).not.toBeNull();
    expect((await admin.query(`select auto_extended_at from sourcing_event where id in ($1,$2)`, [busy, far])).rows.every((r) => r.auto_extended_at === null)).toBe(true);
    expect((await admin.query(`select 1 from notification where event_id = $1 and kind = 'deadline_extended'`, [quiet])).rowCount).toBe(2);
    expect((await admin.query(`select 1 from audit_event where event_id = $1 and action = 'autonomy.auto_extend'`, [quiet])).rowCount).toBe(1);
    await admin.query(`update sourcing_event set closes_at = now() + interval '2 hours' where id = $1`, [quiet]);
    await extendDeadlines(pool, X.tenantId);   // never twice
    expect(new Date((await admin.query(`select closes_at from sourcing_event where id = $1`, [quiet])).rows[0].closes_at).getTime() - Date.now()).toBeLessThan(3 * 3600_000);
    await savePolicy(pool, who(X, "admin"), policy());
  });
  it("pause stops reminders, extension and nudges but not closing", async () => {
    const { extendDeadlines, nudgeApprovers } = await import("@/automation/service");
    const { savePolicy } = await import("@/automation/policy");
    await savePolicy(pool, who(X, "admin"), policy({ paused: true, extendEnabled: true }));
    const soon = await published(3600_000 * 2), late = await published(-60_000, false);
    expect(await sendReminders(pool, X.tenantId)).toBe(0); expect(await extendDeadlines(pool, X.tenantId)).toBe(0); expect(await nudgeApprovers(pool, X.tenantId)).toBe(0);
    expect(await autoClose(pool, X.tenantId)).toBeGreaterThanOrEqual(1);
    expect(await stateOf(late)).toBe("closed"); expect(await stateOf(soon)).toBe("published");
    await savePolicy(pool, who(X, "admin"), policy());
  });
  it("reminds approvers who have not decided on an event that has waited, once per period", async () => {
    const { nudgeApprovers } = await import("@/automation/service");
    const ev = await published(3600_000 * 48, false);
    await admin.query(`update sourcing_event set state = 'pending_publication' where id = $1`, [ev]);
    await admin.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'publication_approver')`, [X.tenantId, ev, X.people.admin.membershipId]);
    await admin.query(`insert into audit_event (tenant_id, event_id, actor, action, at) values ($1,$2,'internal:x','SubmitForPublication', now() - interval '3 days')`, [X.tenantId, ev]);
    expect(await nudgeApprovers(pool, X.tenantId)).toBe(1);
    expect((await admin.query(`select 1 from notification where event_id = $1 and kind = 'approval_nudge'`, [ev])).rowCount).toBe(1);
    expect(await nudgeApprovers(pool, X.tenantId)).toBe(0);
    const done = await published(3600_000 * 48, false);
    await admin.query(`update sourcing_event set state = 'pending_publication' where id = $1`, [done]);
    await admin.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'publication_approver')`, [X.tenantId, done, X.people.admin.membershipId]);
    await admin.query(`insert into audit_event (tenant_id, event_id, actor, action, at) values ($1,$2,'internal:x','SubmitForPublication', now() - interval '3 days')`, [X.tenantId, done]);
    await admin.query(`insert into approval (tenant_id, event_id, step, approver_membership_id, decision, idempotency_key) values ($1,$2,'publication',$3,'approve',$4)`, [X.tenantId, done, X.people.admin.membershipId, randomUUID()]);
    expect(await nudgeApprovers(pool, X.tenantId)).toBe(0);   // already decided
  });
});

describe("the internal clock and its lease", () => {
  it("records each pass per company, and skips a company another runner holds", async () => {
    const { tick, claimRun, lastRun } = await import("@/automation/service");
    expect(await lastRun(pool, X.tenantId)).toBeNull();
    await tick(pool, async () => ({ ok: true, mode: "logged" }), "worker");
    const first = await lastRun(pool, X.tenantId);
    expect(first).toMatchObject({ source: "worker" });
    expect((await admin.query(`select runs, locked_until from autonomy_run where tenant_id = $1`, [X.tenantId])).rows[0]).toMatchObject({ runs: "1", locked_until: null });
    expect(await claimRun(pool, X.tenantId)).toBe(true);    // another runner takes it
    expect(await claimRun(pool, X.tenantId)).toBe(false);   // a second one cannot
    await tick(pool, async () => ({ ok: true, mode: "logged" }), "cron");
    expect((await admin.query(`select runs from autonomy_run where tenant_id = $1`, [X.tenantId])).rows[0].runs).toBe("1");   // skipped, not counted
    await admin.query(`update autonomy_run set locked_until = now() - interval '1 second' where tenant_id = $1`, [X.tenantId]);   // an abandoned lease expires
    await tick(pool, async () => ({ ok: true, mode: "logged" }), "cron");
    expect(await lastRun(pool, X.tenantId)).toMatchObject({ source: "cron" });
  });
  it("keeps running after a failed pass and stops when told", async () => {
    const { runLoop } = await import("@/automation/service");
    const ctrl = new AbortController(); let calls = 0; const logs: string[] = [];
    const pass = (async () => { calls++; if (calls === 1) throw new Error("db down"); if (calls === 3) ctrl.abort(); return { tenants: 0, closed: 0, reminders: 0, extended: 0, nudged: 0, emailed: 0, failed: 0 }; }) as never;
    const n = await runLoop(pool, { intervalMs: 5, signal: ctrl.signal, pass, log: (l) => logs.push(l) });
    expect(calls).toBe(3); expect(n).toBe(2); expect(logs[0]).toContain("pass failed: db down");
  });
});

describe("the page-view backup clock", () => {
  it("runs a pass only when the last one is over a minute old, and at most once a minute per instance", async () => {
    const { pageTick, resetPageTick, tick, lastRun } = await import("@/automation/service");
    resetPageTick();
    await admin.query(`update autonomy_run set last_run_at = now() - interval '5 minutes', locked_until = null where tenant_id = $1`, [X.tenantId]);
    expect(await pageTick(pool, X.tenantId)).toBe(true);
    expect(await lastRun(pool, X.tenantId)).toMatchObject({ source: "page" });
    expect(await pageTick(pool, X.tenantId)).toBe(false);                 // throttled in memory
    resetPageTick();
    expect(await pageTick(pool, X.tenantId)).toBe(false);                 // the database says it ran seconds ago
    await tick(pool, async () => ({ ok: true, mode: "logged" }), "worker");
    expect(await lastRun(pool, X.tenantId)).toMatchObject({ source: "worker" });   // the page check did not block a real runner
  });
});
