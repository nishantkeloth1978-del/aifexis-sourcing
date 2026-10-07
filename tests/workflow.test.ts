import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client, Pool } from "pg";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";
import { addItem, createEvent, getEvent, type Who } from "@/events/service";
import { approvePublication, assignRole, listTeam, listTenantMembers, myEventRoles, removeRole, submitForPublication } from "@/events/workflow";

let admin: Client, pool: Pool, X: World, Y: World;
const as = (w: World, p: keyof World["people"], role = "member"): Who => ({ tenantId: w.tenantId, userId: w.people[p].userId, membershipId: w.people[p].membershipId, role });
const A = () => as(X, "admin", "admin");
const FUTURE = "2035-01-31";

beforeAll(async () => { admin = await adminClient(); pool = makePool(10); X = await seedTenant(admin, "WFX"); Y = await seedTenant(admin, "WFY"); });
afterAll(async () => { await pool.end(); await admin.end(); });

async function ready(opts: { items?: boolean; closes?: string | null; approver?: boolean; buyer?: boolean } = {}) {
  const { items = true, closes = FUTURE, approver = true, buyer = true } = opts;
  const r = await createEvent(pool, as(X, "requester"), { title: "Workflow test", closesAt: closes ?? undefined });
  if (!r.ok) throw new Error("setup");
  const id = r.event.id;
  if (items) await addItem(pool, as(X, "requester"), id, { description: "Pump", quantity: "1", unit: "EA" });
  if (buyer) expect((await assignRole(pool, A(), id, X.people.buyer.membershipId, "buyer")).ok).toBe(true);
  if (approver) expect((await assignRole(pool, A(), id, X.people.pubApprover.membershipId, "publication_approver")).ok).toBe(true);
  return id;
}
const version = async (id: string) => (await getEvent(pool, A(), id))!.stateVersion;

describe("team", () => {
  it("only an administrator assigns roles; the team shows up", async () => {
    const id = await ready({ buyer: false, approver: false });
    expect((await assignRole(pool, as(X, "buyer"), id, X.people.buyer.membershipId, "buyer")).ok).toBe(false);
    expect((await assignRole(pool, A(), id, X.people.buyer.membershipId, "buyer")).ok).toBe(true);
    expect((await listTeam(pool, A(), id)).map((m) => m.role).sort()).toEqual(["buyer", "requester"]);
    expect((await assignRole(pool, A(), id, X.people.buyer.membershipId, "buyer")).ok).toBe(false); // duplicate
  });
  it("separation of duties is explained, not a crash", async () => {
    const id = await ready({ buyer: false, approver: false });
    await assignRole(pool, A(), id, X.people.buyer.membershipId, "buyer");
    const r = await assignRole(pool, A(), id, X.people.buyer.membershipId, "publication_approver");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/separation of duties/);
    expect((await listTeam(pool, A(), id)).filter((m) => m.role === "publication_approver")).toHaveLength(0);
  });
  it("roles can be removed while draft; people from another tenant are refused", async () => {
    const id = await ready();
    expect((await removeRole(pool, A(), id, X.people.buyer.membershipId, "buyer")).ok).toBe(true);
    expect((await assignRole(pool, A(), id, Y.people.buyer.membershipId, "buyer")).ok).toBe(false);
    expect((await listTenantMembers(pool, A())).every((m) => !m.email.includes("WFY"))).toBe(true);
  });
});

describe("publication workflow", () => {
  it("submit then approve: draft -> pending -> published, with audit and a frozen configuration", async () => {
    const id = await ready();
    expect((await myEventRoles(pool, as(X, "buyer"), id))).toContain("buyer");
    expect((await submitForPublication(pool, as(X, "buyer"), id, await version(id))).ok).toBe(true);
    expect((await getEvent(pool, A(), id))?.state).toBe("pending_publication");
    expect((await approvePublication(pool, as(X, "pubApprover"), id, await version(id))).ok).toBe(true);
    expect((await getEvent(pool, A(), id))?.state).toBe("published");
    const row = (await admin.query("select config_snapshot from sourcing_event where id = $1", [id])).rows[0];
    expect(row.config_snapshot).not.toBeNull();
    const a = await admin.query("select action from audit_event where event_id = $1 and action like 'transition:%' order by id", [id]);
    expect(a.rows.map((r) => r.action)).toEqual(["transition:SubmitForPublication", "transition:ApprovePublication"]);
  });
  it("submission needs items, a future closing date and an approver", async () => {
    const noItems = await ready({ items: false });
    const r1 = await submitForPublication(pool, as(X, "buyer"), noItems, await version(noItems));
    expect(!r1.ok && r1.error).toMatch(/at least one item/);
    const noDate = await ready({ closes: null });
    expect((await submitForPublication(pool, as(X, "buyer"), noDate, await version(noDate))).ok).toBe(false);
    const past = await ready({ closes: "2001-01-01" });
    expect((await submitForPublication(pool, as(X, "buyer"), past, await version(past))).ok).toBe(false);
    const noAp = await ready({ approver: false });
    const r4 = await submitForPublication(pool, as(X, "buyer"), noAp, await version(noAp));
    expect(!r4.ok && r4.error).toMatch(/approver/);
  });
  it("only the buyer can submit and only the approver can approve", async () => {
    const id = await ready();
    expect((await submitForPublication(pool, as(X, "requester"), id, await version(id))).ok).toBe(false);
    expect((await submitForPublication(pool, as(X, "pubApprover"), id, await version(id))).ok).toBe(false);
    await submitForPublication(pool, as(X, "buyer"), id, await version(id));
    expect((await approvePublication(pool, as(X, "buyer"), id, await version(id))).ok).toBe(false);
    expect((await approvePublication(pool, as(X, "requester"), id, await version(id))).ok).toBe(false);
    expect((await getEvent(pool, A(), id))?.state).toBe("pending_publication");
  });
  it("items and details are locked once submitted", async () => {
    const id = await ready();
    await submitForPublication(pool, as(X, "buyer"), id, await version(id));
    expect((await addItem(pool, as(X, "requester"), id, { description: "Late", quantity: "1", unit: "EA" })).ok).toBe(false);
    expect((await assignRole(pool, A(), id, X.people.witness.membershipId, "witness")).ok).toBe(false);
  });
  it("a stale version, a repeat submission and a cross-tenant attempt all fail cleanly", async () => {
    const id = await ready();
    const v = await version(id);
    expect((await submitForPublication(pool, as(X, "buyer"), id, v)).ok).toBe(true);
    expect((await submitForPublication(pool, as(X, "buyer"), id, v)).ok).toBe(false);
    expect((await approvePublication(pool, as(X, "pubApprover"), id, v)).ok).toBe(false); // stale
    expect((await approvePublication(pool, as(Y, "pubApprover"), id, await version(id))).ok).toBe(false);
  });
  it("two simultaneous approvals produce exactly one publication", async () => {
    const id = await ready();
    await submitForPublication(pool, as(X, "buyer"), id, await version(id));
    const v = await version(id);
    const rs = await Promise.all([approvePublication(pool, as(X, "pubApprover"), id, v), approvePublication(pool, as(X, "pubApprover"), id, v)]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const n = await admin.query("select count(*)::int n from audit_event where event_id = $1 and action = 'transition:ApprovePublication'", [id]);
    expect(n.rows[0].n).toBe(1);
  });
});
