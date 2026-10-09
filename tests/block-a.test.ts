import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, saveConfig } from "@/config/service";
import { anonymousAliases, getEvalView, saveScores } from "@/evaluation/service";
import { getReassignInfo, reassignEvaluator } from "@/evaluation/reassign";
import { cancelEvent, getCancelInfo } from "@/events/cancel";
import type { Who } from "@/events/service";
import { offsetFrom, remaining } from "@/lib/clock";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"], role = "member"): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role } as Who);
const full = (n: number) => Object.fromEntries(DEFAULT_CONFIG.criteria.map((k) => [k, n]));
const ver = async (id: string) => (await admin.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "blka"); });
afterAll(async () => { await saveConfig(pool, who("admin", "admin"), DEFAULT_CONFIG); await pool.end(); await admin.end(); });

describe("closing clock", () => {
  it("counts down on the server's time", () => {
    const closes = "2026-12-01T12:00:00Z";
    const now = Date.parse("2026-12-01T10:58:50Z");
    expect(remaining(closes, now, 0)).toMatchObject({ done: false, h: 1, m: 1, s: 10 });
    expect(remaining(closes, now, 70_000)).toMatchObject({ done: false, h: 1, m: 0, s: 0 });   // client clock 70 s slow
    expect(remaining(closes, Date.parse("2026-12-01T12:00:01Z"), 0).done).toBe(true);
    expect(remaining("2026-12-04T12:00:00Z", Date.parse("2026-12-01T12:00:00Z"), 0)).toMatchObject({ days: 3 });
  });
  it("estimates the offset from one round trip", () => {
    expect(offsetFrom("2026-01-01T00:00:10.000Z", Date.parse("2026-01-01T00:00:00Z"), Date.parse("2026-01-01T00:00:00.200Z"))).toBe(9900);
  });
});

describe("cancelling an event", () => {
  it("needs the buyer, a reason and an award approver, and stops the event", async () => {
    const e = await makeEvent(admin, X, "published");
    expect(await getCancelInfo(pool, who("techA"), e.id)).toMatchObject({ canCancel: false });
    const info = (await getCancelInfo(pool, who("buyer"), e.id))!;
    expect(info.canCancel).toBe(true);
    expect(info.approvers.map((a) => a.membershipId)).toContain(X.people.awardApprover.membershipId);
    const ap = X.people.awardApprover.membershipId;
    expect(await cancelEvent(pool, who("techA"), e.id, await ver(e.id), { reason: "Scope withdrawn by the business", approverId: ap })).toMatchObject({ ok: false });
    expect(await cancelEvent(pool, who("buyer"), e.id, await ver(e.id), { reason: "short", approverId: ap })).toMatchObject({ ok: false });
    expect(await cancelEvent(pool, who("buyer"), e.id, await ver(e.id), { reason: "Scope withdrawn by the business", approverId: "" })).toMatchObject({ ok: false });
    expect(await cancelEvent(pool, who("buyer"), e.id, await ver(e.id), { reason: "Scope withdrawn by the business", approverId: ap })).toMatchObject({ ok: true });
    const row = (await admin.query(`select state::text as s, cancel_reason, cancelled_at from sourcing_event where id = $1`, [e.id])).rows[0];
    expect(row).toMatchObject({ s: "cancelled", cancel_reason: "Scope withdrawn by the business" });
    expect(row.cancelled_at).toBeTruthy();
    expect((await admin.query(`select count(*)::int n from notification where event_id = $1 and kind = 'cancelled'`, [e.id])).rows[0].n).toBeGreaterThan(0);
    expect(await cancelEvent(pool, who("buyer"), e.id, await ver(e.id), { reason: "Scope withdrawn again", approverId: ap })).toMatchObject({ ok: false });   // already cancelled
    expect(await getCancelInfo(pool, who("buyer"), e.id)).toMatchObject({ canCancel: false, reason: "Scope withdrawn by the business" });
  });
  it("cannot cancel a draft or an awarded event", async () => {
    for (const st of ["draft", "awarded"] as const) {
      const e = await makeEvent(admin, X, st, { withBids: false });
      expect(await cancelEvent(pool, who("buyer"), e.id, await ver(e.id), { reason: "Not needed any more", approverId: X.people.awardApprover.membershipId })).toMatchObject({ ok: false });
    }
  });
});

describe("evaluator reassignment", () => {
  it("replaces an evaluator, drops their scores from the totals and records why", async () => {
    const id = (await makeEvent(admin, X, "technical_evaluation")).id;
    const sup = X.suppliers[0]!.id;
    expect(await saveScores(pool, who("techA"), id, sup, full(9))).toMatchObject({ ok: true });
    expect(await saveScores(pool, who("techB"), id, sup, full(5))).toMatchObject({ ok: true });
    const before = (await getEvalView(pool, who("techApprover"), id))!.results!.find((r) => r.supplierId === sup)!;
    expect(before.total).toBe(70);
    const info = (await getReassignInfo(pool, who("buyer"), id))!;
    expect(info.canReassign).toBe(true);
    expect(info.evaluators.find((e) => e.membershipId === X.people.techA.membershipId)!.scored).toBeGreaterThanOrEqual(4);
    const to = X.people.comm.membershipId;   // comm_evaluator holds a conflicting role? use a member with no role instead
    const free = (await admin.query(`select id from membership where tenant_id = $1 and id not in (select membership_id from event_member where event_id = $2) and role in ('admin','member') limit 1`, [X.tenantId, id])).rows[0]?.id as string | undefined;
    expect(to).toBeTruthy();
    expect(await reassignEvaluator(pool, who("techA"), id, X.people.techA.membershipId, free ?? to, "Evaluator on leave")).toMatchObject({ ok: false });
    expect(await reassignEvaluator(pool, who("buyer"), id, X.people.techA.membershipId, X.people.comm.membershipId, "Evaluator on leave")).toMatchObject({ ok: false });   // comm evaluator conflicts
    expect(await reassignEvaluator(pool, who("buyer"), id, X.people.techA.membershipId, free ?? to, "x")).toMatchObject({ ok: false });
    if (!free) throw new Error("no free member");
    expect(await reassignEvaluator(pool, who("buyer"), id, X.people.techA.membershipId, free, "Evaluator on leave")).toMatchObject({ ok: true });
    const after = (await getEvalView(pool, who("techApprover"), id))!.results!.find((r) => r.supplierId === sup)!;
    expect(after.total).toBe(50);                                          // only techB counts now
    expect((await getReassignInfo(pool, who("buyer"), id))!.history[0]).toMatchObject({ reason: "Evaluator on leave" });
    expect(await reassignEvaluator(pool, who("buyer"), id, X.people.techA.membershipId, free, "Again please")).toMatchObject({ ok: false });   // no longer an evaluator
  });
  it("is refused once the technical result is approved", async () => {
    const id = (await makeEvent(admin, X, "technical_approved")).id;
    expect(await reassignEvaluator(pool, who("buyer"), id, X.people.techA.membershipId, X.people.comm.membershipId, "Late change")).toMatchObject({ ok: false });
  });
});

describe("anonymous evaluation", () => {
  it("shows aliases to evaluators and approvers but names to the buyer, only while scoring", async () => {
    await saveConfig(pool, who("admin", "admin"), { ...DEFAULT_CONFIG, anonymousEvaluation: true });
    const id = (await makeEvent(admin, X, "technical_evaluation")).id;
    const a = (await getEvalView(pool, who("techA"), id))!;
    expect(a.anonymous).toBe(true);
    expect(a.bidders!.every((b) => /^Bidder [A-Z]/.test(b.name))).toBe(true);
    const names = X.suppliers.map((s) => (s as unknown as { name?: string }).name).filter(Boolean) as string[];
    for (const n of names) expect(JSON.stringify(a)).not.toContain(n);
    const ap = (await getEvalView(pool, who("techApprover"), id))!;
    expect(ap.results!.every((r) => /^Bidder /.test(r.name))).toBe(true);
    const b = (await getEvalView(pool, who("buyer"), id))!;
    expect(b.anonymous).toBe(false);
    expect(await anonymousAliases(pool, who("techA"), id)).toBeTruthy();
    expect(await anonymousAliases(pool, who("buyer"), id)).toBeNull();
    const done = (await makeEvent(admin, X, "technical_approved")).id;
    expect((await getEvalView(pool, who("techA"), done))!.anonymous).toBe(false);
  });
});
