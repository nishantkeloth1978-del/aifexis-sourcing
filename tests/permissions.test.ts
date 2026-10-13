import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_PERMS, DEFAULT_PERMS, allowedForRole, can } from "@/access/permissions";
import { assignRole, createRole, deleteRole, explainPerson, listRoles, loadPerms, setRolePermissions } from "@/access/roles";
import { addItem, createEvent, deleteDraftEvent, deleteItem, duplicateEvent, getEvent, listEvents, updateEventBasics, type Who } from "@/events/service";
import { addLot } from "@/lots/service";
import { createSupplier } from "@/suppliers/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World, Y: World;
const who = (w: World, p: keyof World["people"], role = "member", perms?: string[]): Who => ({ tenantId: w.tenantId, userId: w.people[p].userId, membershipId: w.people[p].membershipId, role, ...(perms ? { perms } : {}) });
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "perm-x"); Y = await seedTenant(admin, "perm-y"); });
afterAll(async () => { await pool.end(); await admin.end(); });
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { expect(r, JSON.stringify(r)).toMatchObject({ ok: true }); return r as Extract<T, { ok: true }>; };
const refused = (r: { ok: boolean }) => expect(r).toMatchObject({ ok: false });
const A = () => who(X, "admin", "admin");

describe("permission helpers", () => {
  it("administrators hold everything; members and integration admins use the defaults; unknown roles hold nothing", () => {
    expect(ALL_PERMS.every((p) => can({ role: "admin" }, p))).toBe(true);
    expect(can({ role: "member" }, "event.create")).toBe(true);
    expect(can({ role: "member" }, "event.read_all")).toBe(false);
    expect(can({ role: "member" }, "users.manage")).toBe(false);
    expect(DEFAULT_PERMS.integration_admin).toEqual([]);
    expect(can({ role: "sorcerer" }, "event.create")).toBe(false);
    expect(can({ role: "member", perms: ["catalog.manage"] }, "event.create")).toBe(false);
  });
  it("guardrail: administrator-only and unknown permissions are stripped from every other role", () => {
    expect(allowedForRole(["event.create", "users.manage", "roles.manage", "made.up", "event.create"])).toEqual(["event.create"]);
  });
});

describe("who can see and change an event (SEC-01)", () => {
  let ev: string;
  beforeAll(async () => {
    const r = ok(await createEvent(pool, who(X, "buyer"), { title: "Pumps for plant 4", ownerDept: "Ops", valueAed: "250000" }));
    ev = r.event.id;
    await admin.query(`update sourcing_event set value_aed = 250000 where id = $1`, [ev]);
    // items go in while it is a draft; one with a target price
    const it = ok(await addItem(pool, who(X, "buyer"), ev, { description: "Pump", quantity: "2", unit: "EA" }));
    await admin.query(`update event_item set target_price = 1234.5 where id = $1`, [it.item.id]);
    await admin.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'tech_evaluator')`, [X.tenantId, ev, X.people.techA.membershipId]);
    await admin.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'comm_evaluator')`, [X.tenantId, ev, X.people.comm.membershipId]);
  });
  it("lists: creator, team and administrator see it; an unassigned member does not; 'see every event' does", async () => {
    const ids = async (w: Who) => (await listEvents(pool, w)).map((e) => e.id);
    expect(await ids(who(X, "buyer"))).toContain(ev);
    expect(await ids(who(X, "techA"))).toContain(ev);
    expect(await ids(A())).toContain(ev);
    expect(await ids(who(X, "delegate"))).not.toContain(ev);
    expect(await ids(who(X, "delegate", "member", ["event.create", "event.read_all"]))).toContain(ev);
  });
  it("details: an unassigned member gets nothing, as if it did not exist", async () => {
    expect(await getEvent(pool, who(X, "delegate"), ev)).toBeNull();
    expect(await getEvent(pool, who(X, "delegate", "member", ["event.read_all"]), ev)).not.toBeNull();
  });
  it("target prices and the budget go only to the buying side", async () => {
    const tech = (await getEvent(pool, who(X, "techA"), ev))!;
    expect(tech.valueAed).toBeNull();
    expect(tech.items.every((i) => i.targetPrice === null)).toBe(true);
    const buyer = (await getEvent(pool, who(X, "buyer"), ev))!;
    expect(buyer.valueAed).toBe("250000.00");
    expect(buyer.items[0]!.targetPrice).toMatch(/^1234\.5/);
    const comm = (await getEvent(pool, who(X, "comm"), ev))!;
    expect(comm.items[0]!.targetPrice).toMatch(/^1234\.5/);
  });
  it("editing a draft: only its creator, its buyer or requester, an administrator or someone allowed to edit any draft", async () => {
    const edit = (w: Who) => updateEventBasics(pool, w, ev, { title: "Pumps for plant 4 (edited)", ownerDept: "Ops" });
    refused(await edit(who(X, "delegate")));
    refused(await edit(who(X, "techA")));            // on the team, but not as buyer or requester
    ok(await edit(who(X, "buyer")));
    ok(await edit(A()));
    ok(await edit(who(X, "delegate", "member", ["event.create", "event.edit_any_draft"])));
    refused(await edit(who(X, "delegate", "member", ["event.edit_any_draft"])));   // cannot edit events at all without "create"
  });
  it("items, lots and copies follow the same rule", async () => {
    refused(await addItem(pool, who(X, "delegate"), ev, { description: "Sneaky", quantity: "1", unit: "EA" }));
    refused(await addLot(pool, who(X, "delegate"), ev, "Lot A"));
    ok(await addLot(pool, who(X, "buyer"), ev, "Lot A"));
    const it = (await getEvent(pool, A(), ev))!.items[0]!;
    refused(await deleteItem(pool, who(X, "delegate"), ev, it.id));
    refused(await duplicateEvent(pool, who(X, "delegate"), ev));
    ok(await duplicateEvent(pool, who(X, "buyer"), ev));
  });
  it("deleting a draft: creator or someone allowed to delete any", async () => {
    const mine = ok(await createEvent(pool, who(X, "delegate"), { title: "Temporary draft" })).event.id;
    refused(await deleteDraftEvent(pool, who(X, "witness"), mine));
    ok(await deleteDraftEvent(pool, who(X, "delegate"), mine));
  });
});

describe("organisation roles", () => {
  it("built-in member permissions can be changed and the change reaches the person", async () => {
    expect(await loadPerms(pool, X.tenantId, X.people.buyer.membershipId, "member")).toContain("catalog.manage");
    ok(await setRolePermissions(pool, A(), { key: "member" }, ["event.create", "supplier.manage"]));
    expect(await loadPerms(pool, X.tenantId, X.people.buyer.membershipId, "member")).toEqual(["event.create", "supplier.manage"]);
    ok(await setRolePermissions(pool, A(), { key: "member" }, ["event.create", "catalog.manage", "supplier.manage"]));
  });
  it("only administrators manage roles; administrator-only permissions cannot be granted; the administrator role is fixed", async () => {
    refused(await setRolePermissions(pool, who(X, "buyer"), { key: "member" }, ["event.read_all"]));
    refused(await createRole(pool, who(X, "buyer"), { name: "Sneaky", perms: [] }));
    refused(await listRoles(pool, who(X, "buyer")));
    const r = ok(await setRolePermissions(pool, A(), { key: "member" }, ["event.create", "users.manage", "roles.manage"]));
    expect(r.perms).toEqual(["event.create"]);
    ok(await setRolePermissions(pool, A(), { key: "member" }, ["event.create", "catalog.manage", "supplier.manage"]));
    const list = ok(await listRoles(pool, A()));
    expect(list.roles[0]).toMatchObject({ key: "admin", fixed: true });
    expect(list.roles[0]!.perms).toHaveLength(ALL_PERMS.length);
  });
  it("a custom role: create, assign, take effect, cannot be deleted while in use", async () => {
    const made = ok(await createRole(pool, A(), { name: "Procurement manager", description: "Sees all events", perms: ["event.create", "event.read_all", "users.manage"] }));
    refused(await createRole(pool, A(), { name: "procurement manager", perms: [] }));
    refused(await createRole(pool, A(), { name: "Member", perms: [] }));
    refused(await createRole(pool, A(), { name: "x", perms: [] }));
    const role = ok(await listRoles(pool, A())).roles.find((r) => r.id === made.id)!;
    expect(role.perms).toEqual(["event.create", "event.read_all"]);          // users.manage was stripped
    ok(await assignRole(pool, A(), X.people.comm.membershipId, made.id));
    const perms = await loadPerms(pool, X.tenantId, X.people.comm.membershipId, "member");
    expect(perms).toEqual(["event.create", "event.read_all"]);
    // and the person now sees every event
    expect((await listEvents(pool, who(X, "comm", "member", perms))).length).toBeGreaterThan(0);
    const ex = ok(await explainPerson(pool, A(), X.people.comm.membershipId));
    expect(ex).toMatchObject({ roleName: "Procurement manager" });
    refused(await deleteRole(pool, A(), made.id));
    ok(await assignRole(pool, A(), X.people.comm.membershipId, null));
    expect(await loadPerms(pool, X.tenantId, X.people.comm.membershipId, "member")).toContain("catalog.manage");
    ok(await deleteRole(pool, A(), made.id));
    refused(await assignRole(pool, A(), X.people.admin.membershipId, made.id));
  });
  it("what a role may do is enforced in the services", async () => {
    const noSupplier = who(X, "buyer", "member", ["event.create"]);
    refused(await createSupplier(pool, noSupplier, { name: "Acme", contactEmail: "a@acme.test" }));
    ok(await createSupplier(pool, who(X, "buyer", "member", ["supplier.manage"]), { name: "Acme", contactEmail: "a@acme.test" }));
    refused(await createEvent(pool, who(X, "buyer", "member", ["supplier.manage"]), { title: "No create right" }));
  });
  it("roles are private to their organisation and changes are audited", async () => {
    const yAdmin = who(Y, "admin", "admin");
    const mine = ok(await listRoles(pool, yAdmin));
    expect(mine.roles.filter((r) => !r.builtin)).toEqual([]);
    refused(await assignRole(pool, yAdmin, X.people.buyer.membershipId, null));     // someone else's person
    const n = (await admin.query(`select count(*)::int n from audit_event where tenant_id = $1 and action like 'roles.%'`, [X.tenantId])).rows[0].n;
    expect(n).toBeGreaterThan(3);
  });
});
