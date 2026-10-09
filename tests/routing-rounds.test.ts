import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";
import { addItem, createEvent, getEvent, type Who } from "@/events/service";
import { assignRole, listTeam, submitForPublication } from "@/events/workflow";
import { listRoutes, removeRoute, routeEventTeam, saveRoute, seatFor } from "@/events/routing";
import { getRoundInfo, startFinalRound } from "@/events/rounds";
import { getBidForm, submitBidForm } from "@/bids/service";
import type { SupplierWho } from "@/suppliers/service";

let admin: Client, pool: Pool, X: World;
const as = (p: keyof World["people"], role = "member"): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role });
const A = () => as("admin", "admin");
const sw = (i: 0 | 1 | 2): SupplierWho => ({ tenantId: X.tenantId, supplierId: X.suppliers[i].id, supplierUserId: X.suppliers[i].supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });

beforeAll(async () => { admin = await adminClient(); pool = makePool(10); X = await seedTenant(admin, "RR"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("approver routing", () => {
  it("only an admin sets routes; deputy must differ; absence needs a deputy", async () => {
    expect((await saveRoute(pool, as("buyer"), { step: "publication", slot: 1, ownerId: X.people.pubApprover.membershipId })).ok).toBe(false);
    expect((await saveRoute(pool, A(), { step: "publication", slot: 1, ownerId: X.people.pubApprover.membershipId, deputyId: X.people.pubApprover.membershipId })).ok).toBe(false);
    expect((await saveRoute(pool, A(), { step: "publication", slot: 1, ownerId: X.people.pubApprover.membershipId, awayFrom: "2030-01-01", awayTo: "2030-01-05" })).ok).toBe(false);
    expect((await saveRoute(pool, A(), { step: "publication", slot: 1, ownerId: X.people.pubApprover.membershipId, deputyId: X.people.delegate.membershipId })).ok).toBe(true);
    expect((await listRoutes(pool, A())).filter((r) => r.step === "publication")).toHaveLength(1);
  });
  it("seats the deputy while the owner is away", () => {
    const r = { ownerId: "o", deputyId: "d", awayFrom: "2026-10-01", awayTo: "2026-10-10" };
    expect(seatFor(r, "2026-10-05")).toEqual({ primary: "d", fallback: null });
    expect(seatFor(r, "2026-10-11")).toEqual({ primary: "o", fallback: "d" });
  });
  it("fills empty seats at submit, adds the deputy as delegate, and never replaces people", async () => {
    await saveRoute(pool, A(), { step: "award", slot: 1, ownerId: X.people.awardApprover.membershipId });
    const r = await createEvent(pool, as("requester"), { title: "Routed", closesAt: "2035-01-31" });
    if (!r.ok) throw new Error("setup");
    const id = r.event.id;
    await addItem(pool, as("requester"), id, { description: "Pump", quantity: "1", unit: "EA" });
    await assignRole(pool, A(), id, X.people.buyer.membershipId, "buyer");
    const v = (await getEvent(pool, A(), id))!.stateVersion;
    const s = await submitForPublication(pool, as("buyer"), id, v);
    expect(s.ok).toBe(true);
    const team = await listTeam(pool, A(), id);
    expect(team.find((m) => m.role === "publication_approver")?.membershipId).toBe(X.people.pubApprover.membershipId);
    expect(team.find((m) => m.role === "award_approver")?.membershipId).toBe(X.people.awardApprover.membershipId);
    expect((await admin.query(`select count(*)::int n from delegation where event_id = $1 and to_membership_id = $2`, [id, X.people.delegate.membershipId])).rows[0].n).toBe(1);
    expect((await admin.query(`select count(*)::int n from audit_event where event_id = $1 and action = 'team.routed'`, [id])).rows[0].n).toBe(1);
  });
  it("skips a person who conflicts with separation of duties, using the deputy", async () => {
    await saveRoute(pool, A(), { step: "publication", slot: 1, ownerId: X.people.buyer.membershipId, deputyId: X.people.delegate.membershipId });
    const r = await createEvent(pool, as("requester"), { title: "SoD", closesAt: "2035-01-31" });
    if (!r.ok) throw new Error("setup");
    await assignRole(pool, A(), r.event.id, X.people.buyer.membershipId, "buyer");
    expect(await routeEventTeam(pool, A(), r.event.id)).toMatchObject({ ok: true });
    expect((await listTeam(pool, A(), r.event.id)).find((m) => m.role === "publication_approver")?.membershipId).toBe(X.people.delegate.membershipId);
  });
  it("removes a route", async () => {
    const rows = await listRoutes(pool, A());
    expect((await removeRoute(pool, A(), rows[0]!.id)).ok).toBe(true);
    expect((await removeRoute(pool, as("buyer"), rows[0]!.id)).ok).toBe(false);
  });
});

describe("best-and-final round", () => {
  it("starts from commercial evaluation with an approver, shortlists, and gates bidding to the shortlist", async () => {
    const ev = await makeEvent(admin, X, "commercial_evaluation");
    const buyer = as("buyer");
    await admin.query(`set session_replication_role = replica`);
    await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type) values ($1,$2,1,'Item','1','ea','LUMP_SUM')`, [X.tenantId, ev.id]);
    await admin.query(`set session_replication_role = origin`);
    const info = (await getRoundInfo(pool, buyer, ev.id))!;
    expect(info.canStart).toBe(true);
    expect(info.candidates.map((c) => c.name)).toEqual(["Supplier 1", "Supplier 2", "Supplier 3"]);
    const closes = new Date(Date.now() + 86400000).toISOString();
    const ver = (await getEvent(pool, A(), ev.id))!.stateVersion;
    const shortlist = [X.suppliers[0].id, X.suppliers[1].id];
    expect(await startFinalRound(pool, buyer, ev.id, ver, { shortlist, closesAt: closes, reason: "Close margin", approverId: "" })).toMatchObject({ ok: false });
    expect(await startFinalRound(pool, buyer, ev.id, ver, { shortlist: [randomUUID()], closesAt: closes, reason: "Close margin", approverId: X.people.awardApprover.membershipId })).toMatchObject({ ok: false });
    expect(await startFinalRound(pool, buyer, ev.id, ver, { shortlist, closesAt: new Date(Date.now() - 1000).toISOString(), reason: "Close margin", approverId: X.people.awardApprover.membershipId })).toMatchObject({ ok: false });
    expect(await startFinalRound(pool, as("techA"), ev.id, ver, { shortlist, closesAt: closes, reason: "Close margin", approverId: X.people.awardApprover.membershipId })).toMatchObject({ ok: false });
    expect(await startFinalRound(pool, buyer, ev.id, ver, { shortlist, closesAt: closes, reason: "Close margin", approverId: X.people.awardApprover.membershipId })).toMatchObject({ ok: true, roundNo: 2 });

    const row = (await admin.query(`select state, round_no, envelope1_opened_at, envelope2_opened_at from sourcing_event where id = $1`, [ev.id])).rows[0];
    expect(row).toMatchObject({ state: "published", round_no: 2, envelope1_opened_at: null, envelope2_opened_at: null });
    expect((await admin.query(`select count(*)::int n from qualified_bidder where event_id = $1 and superseded_at is null`, [ev.id])).rows[0].n).toBe(0);
    expect((await admin.query(`select count(*)::int n from notification where event_id = $1 and kind = 'final_round'`, [ev.id])).rows[0].n).toBe(2);

    // shortlisted supplier revises (new revision, old one kept); the other is shut out
    const itemId = (await admin.query(`select id from event_item where event_id = $1`, [ev.id])).rows[0].id as string;
    expect((await getBidForm(pool, sw(0), ev.id))?.open).toBe(true);
    const out = await getBidForm(pool, sw(2), ev.id);
    expect(out?.open).toBe(false);
    expect(await submitBidForm(pool, sw(2), ev.id, { prices: { [itemId]: "5" }, technicalText: "Technical text here." })).toMatchObject({ ok: false });
    expect(await submitBidForm(pool, sw(0), ev.id, { prices: { [itemId]: "5" }, technicalText: "Technical text here." })).toMatchObject({ ok: true, revisionNo: 2 });
    expect((await admin.query(`select count(*)::int n from bid_revision where event_id = $1 and supplier_id = $2`, [ev.id, X.suppliers[0].id])).rows[0].n).toBe(2);
    expect((await getRoundInfo(pool, buyer, ev.id))?.rounds).toHaveLength(1);
  });
  it("is refused before the commercial envelopes are open", async () => {
    const ev = await makeEvent(admin, X, "technical_evaluation");
    const ver = (await getEvent(pool, A(), ev.id))!.stateVersion;
    expect(await startFinalRound(pool, as("buyer"), ev.id, ver, { shortlist: [X.suppliers[0].id], closesAt: new Date(Date.now() + 86400000).toISOString(), reason: "Close margin", approverId: X.people.awardApprover.membershipId })).toMatchObject({ ok: false });
  });
});
