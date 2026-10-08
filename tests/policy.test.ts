import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, policyFor, saveConfig } from "@/config/service";
import { addItem, createEvent, parseValue, updateEventBasics, type Who } from "@/events/service";
import { approvePublication, submitForPublication } from "@/events/workflow";
import { awardsReport, evaluationBoard } from "@/reports/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"], role = "member"): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role } as Who);
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "policy"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("policy rules", () => {
  it("works out auto-publish and award approvals from the value", () => {
    const cfg = { ...DEFAULT_CONFIG, approval: { publicationThreshold: 100000, awardTiers: [{ minValue: 500000, approvals: 2 }, { minValue: 2000000, approvals: 3 }] } };
    expect(policyFor(cfg, 99999.99)).toEqual({ autoPublish: true, awardApprovals: 1 });
    expect(policyFor(cfg, 100000)).toEqual({ autoPublish: false, awardApprovals: 1 });
    expect(policyFor(cfg, 600000)).toEqual({ autoPublish: false, awardApprovals: 2 });
    expect(policyFor(cfg, 2000000).awardApprovals).toBe(3);
    expect(policyFor(cfg, null)).toEqual({ autoPublish: false, awardApprovals: 1 });
    expect(policyFor(DEFAULT_CONFIG, 5)).toEqual({ autoPublish: false, awardApprovals: 1 });
  });
  it("parses the estimated value", () => {
    expect(parseValue("1,250,000.50")).toEqual({ ok: true, value: "1250000.50" });
    expect(parseValue("  ")).toEqual({ ok: true, value: null });
    expect(parseValue("-5")).toMatchObject({ ok: false }); expect(parseValue("12.345")).toMatchObject({ ok: false }); expect(parseValue("abc")).toMatchObject({ ok: false });
  });
  it("validates the approval rules in the configuration", async () => {
    const a = who("admin", "admin");
    expect(await saveConfig(pool, a, { ...DEFAULT_CONFIG, approval: { publicationThreshold: -1 } })).toMatchObject({ ok: false });
    expect(await saveConfig(pool, a, { ...DEFAULT_CONFIG, approval: { awardTiers: [{ minValue: 10, approvals: 0 }] } })).toMatchObject({ ok: false });
    expect(await saveConfig(pool, a, { ...DEFAULT_CONFIG, approval: { awardTiers: [{ minValue: 10, approvals: 2 }, { minValue: 10, approvals: 3 }] } })).toMatchObject({ ok: false });
    expect(await saveConfig(pool, a, { ...DEFAULT_CONFIG, approval: { publicationThreshold: 100000, awardTiers: [{ minValue: 500000, approvals: 2 }] } })).toMatchObject({ ok: true });
  });
});

async function draft(value: string | null, team: [keyof World["people"], string][]) {
  const e = await createEvent(pool, who("requester"), { title: "Policy event", closesAt: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) });
  if (!e.ok) throw new Error(e.error);
  const id = e.event.id;
  expect(await addItem(pool, who("requester"), id, { description: "Thing", quantity: "1", unit: "ea" })).toMatchObject({ ok: true });
  if (value !== null) expect(await updateEventBasics(pool, who("requester"), id, { title: "Policy event", closesAt: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), valueAed: value })).toMatchObject({ ok: true });
  for (const [p, role] of [["buyer", "buyer"], ...team] as [keyof World["people"], string][])
    await admin.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,$4) on conflict do nothing`, [X.tenantId, id, X.people[p].membershipId, role]);
  const v = (await admin.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;
  return { id, v };
}
const row = async (id: string) => (await admin.query(`select state::text s, required_award_approvals r, value_aed::text v from sourcing_event where id = $1`, [id])).rows[0];

describe("approval by value, end to end", () => {
  it("publishes by itself below the threshold, with a record of why", async () => {
    const { id, v } = await draft("50000", [["awardApprover", "award_approver"]]);
    expect(await submitForPublication(pool, who("buyer"), id, v)).toMatchObject({ ok: true });
    expect(await row(id)).toMatchObject({ s: "published", r: 1, v: "50000.00" });
    expect((await admin.query(`select 1 from audit_event where event_id = $1 and action = 'publication.auto_approved'`, [id])).rowCount).toBe(1);
  });
  it("still needs an approver at or above the threshold, and when no value is set", async () => {
    for (const val of ["200000", null]) {
      const { id, v } = await draft(val, [["awardApprover", "award_approver"]]);
      expect(await submitForPublication(pool, who("buyer"), id, v)).toMatchObject({ ok: false, error: expect.stringContaining("publication approver") });
      await admin.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'publication_approver')`, [X.tenantId, id, X.people.pubApprover.membershipId]);
      expect(await submitForPublication(pool, who("buyer"), id, v)).toMatchObject({ ok: true });
      expect((await row(id)).s).toBe("pending_publication");
      expect(await approvePublication(pool, who("pubApprover"), id, v + 1)).toMatchObject({ ok: true });
      expect(await row(id)).toMatchObject({ s: "published", r: 1 });
    }
  });
  it("asks for more award approvers on high-value events and records the number", async () => {
    const { id, v } = await draft("600000", [["pubApprover", "publication_approver"], ["awardApprover", "award_approver"]]);
    expect(await submitForPublication(pool, who("buyer"), id, v)).toMatchObject({ ok: false, error: expect.stringContaining("2 award approvers") });
    await admin.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'award_approver')`, [X.tenantId, id, X.people.delegate.membershipId]);
    expect(await submitForPublication(pool, who("buyer"), id, v)).toMatchObject({ ok: true });
    expect(await approvePublication(pool, who("pubApprover"), id, v + 1)).toMatchObject({ ok: true });
    expect((await row(id)).r).toBe(2);
  });
  it("the system cannot publish an event on its own authority", async () => {
    const { id, v } = await draft("200000", [["pubApprover", "publication_approver"], ["awardApprover", "award_approver"]]);
    await submitForPublication(pool, who("buyer"), id, v);
    const { applyTransition, withTenant } = await import("@/authz");
    const r = await withTenant(pool, X.tenantId, (c) => applyTransition(c, { kind: "system", tenantId: X.tenantId }, id, "ApprovePublication", { expectedVersion: v + 1 }));
    expect(r.ok).toBe(false);
    expect((await row(id)).s).toBe("pending_publication");
  });
});

describe("evaluation board and awards report", () => {
  it("lists events in evaluation and computes savings against the estimate", async () => {
    const closed = await makeEvent(admin, X, "closed");
    expect((await evaluationBoard(pool, who("buyer"))).some((r) => r.id === closed.id)).toBe(true);
    expect((await evaluationBoard(pool, who("buyer"))).every((r) => r.state !== "published")).toBe(true);
    const e = await makeEvent(admin, X, "draft");
    await admin.query(`update sourcing_event set state = 'awarded', currency = 'AED', value_aed = 2000 where id = $1`, [e.id]);
    const win = X.suppliers[0].id;
    const rev = (await admin.query(`select id from bid_revision where event_id = $1 and supplier_id = $2`, [e.id, win])).rows[0].id;
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D7','price_lines',$3)`, [X.tenantId, rev, JSON.stringify({ total: "1125.00", lines: [] })]);
    await admin.query(`insert into recommendation (tenant_id, event_id, supplier_id, note, created_by) values ($1,$2,$3,'Lowest compliant bid.',$4)`, [X.tenantId, e.id, win, X.people.buyer.membershipId]);
    const rep = await awardsReport(pool, who("buyer"));
    expect(rep.rows.find((r) => r.id === e.id)).toMatchObject({ total: "1125.00", estimate: "2000.00", saving: "875.00", savingPct: 43.8 });
    expect(rep.kpis.count).toBeGreaterThanOrEqual(1);
    expect(Number(rep.kpis.saving)).toBeGreaterThanOrEqual(875);
  });
});
