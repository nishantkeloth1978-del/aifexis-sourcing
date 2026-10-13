import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Who } from "@/events/service";
import * as U from "@/users/service";
import * as P from "@/platform/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const as = (p: keyof World["people"], role = "member"): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role } as Who);
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "users"); });
afterAll(async () => { await pool.end(); await admin.end(); });
const ok = <T,>(r: { ok: boolean } & T) => { expect(r).toMatchObject({ ok: true }); return r as T & { ok: true };};
const email = () => `new-${randomUUID().slice(0, 8)}@acme.test`;

describe("invitations and joining", () => {
  it("admin invites, the person joins, and the link works once", async () => {
    const e = email();
    const inv = ok(await U.inviteMember(pool, as("admin", "admin"), { email: e, role: "member", title: "Buyer", department: "Procurement" }));
    expect((await admin.query(`select token_hash from staff_invitation where email = $1`, [e])).rows[0].token_hash).not.toContain(inv.token);
    expect(await U.staffInviteInfo(pool, inv.token)).toMatchObject({ email: e, role: "member", expired: false });
    const auth = randomUUID();
    expect(await U.acceptStaffInvite(pool, inv.token, auth, e)).toBe(true);
    const m = (await admin.query(`select m.role, m.title, m.department from membership m join app_user u on u.id = m.user_id where u.email = $1`, [e])).rows[0];
    expect(m).toEqual({ role: "member", title: "Buyer", department: "Procurement" });
    expect((await pool.query(`select * from resolve_login($1, $2)`, [auth, e])).rowCount).toBe(1);
    expect(await U.acceptStaffInvite(pool, inv.token, randomUUID(), e)).toBe(false);
    expect((await admin.query(`select 1 from email_outbox where to_email = $1`, [e])).rowCount).toBe(1);
  });
  it("a different email, an expired or a revoked link is refused", async () => {
    const e = email();
    const inv = ok(await U.inviteMember(pool, as("admin", "admin"), { email: e, role: "member" }));
    expect(await U.acceptStaffInvite(pool, inv.token, randomUUID(), "someone-else@acme.test")).toBe(false);
    await admin.query(`update staff_invitation set expires_at = now() - interval '1 minute' where email = $1`, [e]);
    expect(await U.acceptStaffInvite(pool, inv.token, randomUUID(), e)).toBe(false);
    const e2 = email();
    const inv2 = ok(await U.inviteMember(pool, as("admin", "admin"), { email: e2, role: "member" }));
    const id = (await admin.query(`select id from staff_invitation where email = $1`, [e2])).rows[0].id;
    ok(await U.revokeInvite(pool, as("admin", "admin"), id));
    expect(await U.acceptStaffInvite(pool, inv2.token, randomUUID(), e2)).toBe(false);
    expect(await U.staffInviteInfo(pool, "not-a-token")).toBeNull();
  });
  it("only administrators can manage users; bad input is refused", async () => {
    expect(await U.inviteMember(pool, as("buyer"), { email: email(), role: "member" })).toMatchObject({ ok: false });
    expect(await U.listMembers(pool, as("buyer"))).toMatchObject({ ok: false });
    expect(await U.inviteMember(pool, as("admin", "admin"), { email: "nope", role: "member" })).toMatchObject({ ok: false });
    expect(await U.inviteMember(pool, as("admin", "admin"), { email: email(), role: "superuser" })).toMatchObject({ ok: false });
  });
});

describe("changing and switching off people", () => {
  it("changes role and title; protects the last administrator and the self", async () => {
    const a = as("admin", "admin");
    ok(await U.updateMember(pool, a, X.people.buyer.membershipId, { title: "Senior buyer", department: "Sourcing" }));
    expect((await admin.query(`select title from membership where id = $1`, [X.people.buyer.membershipId])).rows[0].title).toBe("Senior buyer");
    expect(await U.updateMember(pool, a, X.people.admin.membershipId, { role: "member" })).toMatchObject({ ok: false });
    expect(await U.setMemberActive(pool, a, X.people.admin.membershipId, false)).toMatchObject({ ok: false });
    ok(await U.updateMember(pool, a, X.people.buyer.membershipId, { role: "admin" }));
    ok(await U.updateMember(pool, a, X.people.admin.membershipId, { role: "member" }));
    ok(await U.updateMember(pool, a, X.people.admin.membershipId, { role: "admin" }));
    ok(await U.updateMember(pool, a, X.people.buyer.membershipId, { role: "member" }));
  });
  it("a switched-off person cannot sign in; switching back on restores access", async () => {
    const a = as("admin", "admin"), auth = randomUUID();
    await admin.query(`update app_user set auth_user_id = $1 where id = $2`, [auth, X.people.witness.userId]);
    const em = (await admin.query(`select email from app_user where id = $1`, [X.people.witness.userId])).rows[0].email;
    expect((await pool.query(`select * from resolve_login($1, $2)`, [auth, em])).rowCount).toBe(1);
    ok(await U.setMemberActive(pool, a, X.people.witness.membershipId, false));
    expect((await pool.query(`select * from resolve_login($1, $2)`, [auth, em])).rowCount).toBe(0);
    ok(await U.setMemberActive(pool, a, X.people.witness.membershipId, true));
    expect((await pool.query(`select * from resolve_login($1, $2)`, [auth, em])).rowCount).toBe(1);
  });
  it("lists people and pending invitations", async () => {
    const r = ok(await U.listMembers(pool, as("admin", "admin")));
    expect(r.members.length).toBeGreaterThan(10);
  });
});

describe("tenant isolation", () => {
  it("another organisation's administrator cannot see or touch these invitations or people", async () => {
    const Y = await seedTenant(admin, "users-other");
    const other: Who = { tenantId: Y.tenantId, userId: Y.people.admin.userId, membershipId: Y.people.admin.membershipId, role: "admin" } as Who;
    const e = email();
    ok(await U.inviteMember(pool, as("admin", "admin"), { email: e, role: "member" }));
    const l = ok(await U.listMembers(pool, other));
    expect(l.invites.find((i) => i.email === e)).toBeUndefined();
    expect(await U.updateMember(pool, other, X.people.buyer.membershipId, { role: "admin" })).toMatchObject({ ok: false });
  });
});

describe("platform console", () => {
  it("creates an organisation with a first administrator who can join; names are unique; suspension blocks sign-in", async () => {
    const name = `Org ${randomUUID().slice(0, 6)}`, e = email();
    const c = ok(await P.createTenant(pool, name, e));
    expect(await P.createTenant(pool, name, email())).toMatchObject({ ok: false });
    expect(await P.createTenant(pool, "x", "bad")).toMatchObject({ ok: false });
    const auth = randomUUID();
    expect(await U.acceptStaffInvite(pool, c.token, auth, e)).toBe(true);
    expect((await pool.query(`select role from resolve_login($1, $2)`, [auth, e])).rows[0].role).toBe("admin");
    const row = (await P.listTenants(pool)).find((t) => t.id === c.tenantId)!;
    expect(row).toMatchObject({ members: 1, admins: 1, suspended: false });
    ok(await P.setTenantSuspended(pool, c.tenantId, true));
    expect((await pool.query(`select * from resolve_login($1, $2)`, [auth, e])).rowCount).toBe(0);
    ok(await P.setTenantSuspended(pool, c.tenantId, false));
    expect((await pool.query(`select * from resolve_login($1, $2)`, [auth, e])).rowCount).toBe(1);
    const again = ok(await P.inviteTenantAdmin(pool, c.tenantId, email()));
    expect(again.token).toBeTruthy();
    expect(await P.inviteTenantAdmin(pool, randomUUID(), e)).toMatchObject({ ok: false });
  });
  it("owner list comes only from PLATFORM_ADMIN_EMAILS", () => {
    const env = { PLATFORM_ADMIN_EMAILS: "Owner@x.com, b@y.com" };
    expect(P.isPlatformAdmin("owner@x.com", env)).toBe(true);
    expect(P.isPlatformAdmin("c@z.com", env)).toBe(false);
    expect(P.isPlatformAdmin(null, env)).toBe(false);
    expect(P.isPlatformAdmin("a@b.com", {})).toBe(false);
  });
});

describe("supplier role", () => {
  it("app_supplier cannot read invitations or run platform functions", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query("set local role app_supplier");
      await expect(c.query(`select * from staff_invitation`)).rejects.toThrow();
      await c.query("rollback"); await c.query("begin"); await c.query("set local role app_supplier");
      await expect(c.query(`select * from platform_list_tenants()`)).rejects.toThrow();
    } finally { await c.query("rollback").catch(() => undefined); c.release(); }
  });
});
