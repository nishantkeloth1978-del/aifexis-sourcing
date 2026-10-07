import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client, Pool } from "pg";
import { randomUUID } from "node:crypto";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";
import { createEvent, type Who } from "@/events/service";
import { acceptInvitation, createSupplier, hashToken, inviteSupplier, invitationInfo, listInvitations, listInvitedEvents, listSuppliers, resolveSupplierLogin } from "@/suppliers/service";

let admin: Client, pool: Pool, X: World, Y: World;
const as = (w: World, p: keyof World["people"], role = "member"): Who => ({ tenantId: w.tenantId, userId: w.people[p].userId, membershipId: w.people[p].membershipId, role });
const A = () => as(X, "admin", "admin");

beforeAll(async () => { admin = await adminClient(); pool = makePool(10); X = await seedTenant(admin, "SUX"); Y = await seedTenant(admin, "SUY"); });
afterAll(async () => { await pool.end(); await admin.end(); });

const publishedEvent = async () => {
  const r = await createEvent(pool, A(), { title: "Supplier test event", closesAt: "2035-01-01" });
  if (!r.ok) throw new Error("setup");
  await admin.query("update sourcing_event set state = 'published' where id = $1", [r.event.id]);
  await admin.query("insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1, $2, $3, 'buyer')", [X.tenantId, r.event.id, X.people.buyer.membershipId]);
  return r.event.id;
};
const newSupplier = async (name = `Acme ${randomUUID().slice(0, 6)}`, email = `s-${randomUUID().slice(0, 8)}@acme.test`) => {
  const r = await createSupplier(pool, A(), { name, contactName: "Sam", contactEmail: email });
  if (!r.ok) throw new Error(r.error);
  return { ...r.supplier, email };
};

describe("supplier register", () => {
  it("creates a supplier with a contact login record; rejects duplicates, bad emails and staff emails", async () => {
    const s = await newSupplier("Unique Pumps LLC", "contact@uniquepumps.test");
    expect((await listSuppliers(pool, A())).some((x) => x.id === s.id)).toBe(true);
    expect((await createSupplier(pool, A(), { name: "unique pumps llc", contactEmail: "other@x.test" })).ok).toBe(false);
    expect((await createSupplier(pool, A(), { name: "Bad Email Co", contactEmail: "nope" })).ok).toBe(false);
    const staff = (await admin.query("select email from app_user where id = $1", [X.people.buyer.userId])).rows[0].email;
    const r = await createSupplier(pool, A(), { name: "Staff Co", contactEmail: staff });
    expect(!r.ok && r.error).toMatch(/own organisation/);
  });
  it("is private to the tenant", async () => {
    await newSupplier("Hidden From Y Ltd");
    expect((await listSuppliers(pool, as(Y, "admin", "admin"))).some((x) => x.name === "Hidden From Y Ltd")).toBe(false);
  });
});

describe("invitations", () => {
  it("need a published event and the buyer or an administrator; the plain token is never stored", async () => {
    const s = await newSupplier();
    const draft = await createEvent(pool, A(), { title: "Still a draft" });
    if (!draft.ok) throw new Error("setup");
    expect((await inviteSupplier(pool, A(), draft.event.id, s.id)).ok).toBe(false);
    const ev = await publishedEvent();
    expect((await inviteSupplier(pool, as(X, "witness"), ev, s.id)).ok).toBe(false);
    const r = await inviteSupplier(pool, as(X, "buyer"), ev, s.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stored = (await admin.query("select token_hash from invitation where event_id = $1 and supplier_id = $2", [ev, s.id])).rows[0].token_hash;
    expect(stored).toBe(hashToken(r.token));
    expect(stored).not.toContain(r.token);
    expect((await listInvitations(pool, A(), ev))[0]?.status).toBe("Invited");
  });
  it("re-issuing replaces the old link", async () => {
    const s = await newSupplier(); const ev = await publishedEvent();
    const a = await inviteSupplier(pool, A(), ev, s.id); const b = await inviteSupplier(pool, A(), ev, s.id);
    if (!a.ok || !b.ok) throw new Error("setup");
    expect(await invitationInfo(pool, a.token)).toBeNull();
    expect((await invitationInfo(pool, b.token))?.supplierName).toBe(s.name);
  });
  it("another tenant cannot invite to this event or use this supplier", async () => {
    const s = await newSupplier(); const ev = await publishedEvent();
    expect((await inviteSupplier(pool, as(Y, "admin", "admin"), ev, s.id)).ok).toBe(false);
  });
});

describe("accepting an invitation and supplier login", () => {
  it("links the login, shows only this supplier's events, and is repeatable", async () => {
    const s1 = await newSupplier(); const s2 = await newSupplier(); const ev = await publishedEvent(); const other = await publishedEvent();
    const i1 = await inviteSupplier(pool, A(), ev, s1.id); await inviteSupplier(pool, A(), other, s2.id);
    if (!i1.ok) throw new Error("setup");
    const auth = randomUUID();
    expect(await acceptInvitation(pool, i1.token, auth, s1.email.toUpperCase())).toBe(true);
    expect(await acceptInvitation(pool, i1.token, auth, s1.email)).toBe(true);
    const who = await resolveSupplierLogin(pool, auth);
    expect(who?.supplierId).toBe(s1.id);
    const evs = await listInvitedEvents(pool, who!);
    expect(evs.map((e) => e.id)).toEqual([ev]);
    expect((await listInvitations(pool, A(), ev))[0]?.status).toBe("Accepted");
  });
  it("refuses wrong email, wrong person, bad or expired tokens", async () => {
    const s = await newSupplier(); const ev = await publishedEvent();
    const i = await inviteSupplier(pool, A(), ev, s.id); if (!i.ok) throw new Error("setup");
    expect(await acceptInvitation(pool, i.token, randomUUID(), "someone.else@x.test")).toBe(false);
    expect(await acceptInvitation(pool, "short", randomUUID(), s.email)).toBe(false);
    expect(await acceptInvitation(pool, "A".repeat(43), randomUUID(), s.email)).toBe(false);
    const first = randomUUID();
    expect(await acceptInvitation(pool, i.token, first, s.email)).toBe(true);
    expect(await acceptInvitation(pool, i.token, randomUUID(), s.email)).toBe(false); // already linked to someone else
    await admin.query("update invitation set expires_at = now() - interval '1 day' where event_id = $1", [ev]);
    expect(await acceptInvitation(pool, i.token, first, s.email)).toBe(false);
    expect((await invitationInfo(pool, i.token))?.expired).toBe(true);
  });
  it("a supplier login is not a staff login", async () => {
    const s = await newSupplier(); const ev = await publishedEvent();
    const i = await inviteSupplier(pool, A(), ev, s.id); if (!i.ok) throw new Error("setup");
    const auth = randomUUID(); await acceptInvitation(pool, i.token, auth, s.email);
    expect((await pool.query("select * from resolve_login($1, $2)", [auth, s.email])).rowCount).toBe(0);
  });
});
