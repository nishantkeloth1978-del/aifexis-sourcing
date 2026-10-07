import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client, Pool } from "pg";
import { randomUUID } from "node:crypto";
import { withTenant } from "@/authz";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World, Y: World;
let xEvents = 0, yEvents = 0;

beforeAll(async () => {
  admin = await adminClient();
  pool = makePool(5);
  X = await seedTenant(admin, "X");
  Y = await seedTenant(admin, "Y");
  for (const s of ["draft", "published", "closed"] as const) { await makeEvent(admin, X, s); xEvents++; }
  for (const s of ["draft", "published"] as const) { await makeEvent(admin, Y, s); yEvents++; }
});
afterAll(async () => { await pool.end(); await admin.end(); });

const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as Error).message; } };

describe("tenant isolation (row-level security)", () => {
  it("a tenant sees only its own rows", async () => {
    const n = await withTenant(pool, X.tenantId, async (c) => (await c.query("select count(*)::int n from sourcing_event")).rows[0].n);
    expect(n).toBe(xEvents);
  });
  it("another tenant's row cannot be read by id", async () => {
    const yEvent = (await admin.query("select id from sourcing_event where tenant_id = $1 limit 1", [Y.tenantId])).rows[0].id;
    const n = await withTenant(pool, X.tenantId, async (c) => (await c.query("select count(*)::int n from sourcing_event where id = $1", [yEvent])).rows[0].n);
    expect(n).toBe(0);
  });
  it("writing into another tenant is rejected", async () => {
    const msg = await fails(withTenant(pool, X.tenantId, (c) =>
      c.query("insert into sourcing_event (tenant_id, title) values ($1, 'x')", [Y.tenantId])));
    expect(msg).toMatch(/row-level security/);
  });
  it("without a tenant set, nothing is visible", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role app_runtime");
      expect((await client.query("select count(*)::int n from sourcing_event")).rows[0].n).toBe(0);
      await client.query("rollback");
    } finally { client.release(); }
  });
  it("composite foreign keys keep children inside the tenant", async () => {
    const xEvent = (await admin.query("select id from sourcing_event where tenant_id = $1 limit 1", [X.tenantId])).rows[0].id;
    const msg = await fails(withTenant(pool, Y.tenantId, (c) => c.query(
      `insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key) values ($1, $2, $3, 1, 'k')`,
      [Y.tenantId, xEvent, Y.suppliers[0].id])));
    expect(msg).toMatch(/foreign key/);
  });
});

describe("pooled connections do not leak the tenant", () => {
  it("1,000 interleaved requests from two tenants never see each other's rows", async () => {
    let mismatches = 0;
    const one = async (i: number) => {
      const t = i % 2 === 0 ? X : Y;
      const expected = i % 2 === 0 ? xEvents : yEvents;
      const n = await withTenant(pool, t.tenantId, async (c) => {
        if (i % 7 === 0) await new Promise((r) => setTimeout(r, 1)); // shuffle interleaving
        const rows = (await c.query("select tenant_id from sourcing_event")).rows;
        if (rows.some((r) => r.tenant_id !== t.tenantId)) mismatches++;
        return rows.length;
      });
      if (n !== expected) mismatches++;
    };
    for (let batch = 0; batch < 20; batch++) await Promise.all(Array.from({ length: 50 }, (_, k) => one(batch * 50 + k)));
    expect(mismatches).toBe(0);
  });
  it("the tenant setting does not survive the transaction on a reused connection", async () => {
    for (let i = 0; i < 20; i++) {
      await withTenant(pool, X.tenantId, async () => undefined);
      const c = await pool.connect();
      try {
        const v = (await c.query("select current_setting('app.tenant_id', true) as v")).rows[0].v;
        expect(v === null || v === "").toBe(true);
      } finally { c.release(); }
    }
  });
});

describe("integrity rules in the database", () => {
  it("submitted bid revisions and items cannot be changed or deleted", async () => {
    const ev = await makeEvent(admin, X, "closed");
    const msg1 = await fails(withTenant(pool, X.tenantId, (c) => c.query("update bid_revision set revision_no = 9 where event_id = $1", [ev.id])));
    const msg2 = await fails(withTenant(pool, X.tenantId, (c) => c.query("delete from bid_item where bid_revision_id in (select id from bid_revision where event_id = $1)", [ev.id])));
    expect(msg1).toMatch(/immutable/);
    expect(msg2).toMatch(/immutable/);
  });
  it("the same idempotency key cannot create a second revision", async () => {
    const ev = await makeEvent(admin, X, "published", { withBids: false });
    const key = randomUUID();
    const ins = (rev: number) => withTenant(pool, X.tenantId, (c) => c.query(
      `insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key) values ($1, $2, $3, $4, $5)`,
      [X.tenantId, ev.id, X.suppliers[0].id, rev, key]));
    await ins(1);
    expect(await fails(ins(2))).toMatch(/duplicate key/);
  });
  it("a derived item must carry the class that matches its source", async () => {
    const ev = await makeEvent(admin, X, "closed");
    const d7 = (await admin.query(
      `select bi.id from bid_item bi join bid_revision br on br.id = bi.bid_revision_id where br.event_id = $1 and bi.data_class = 'D7' limit 1`, [ev.id])).rows[0].id;
    const bad = await fails(withTenant(pool, X.tenantId, (c) => c.query(
      `insert into derived_item (tenant_id, bid_item_id, data_class, kind, content) values ($1, $2, 'D8', 't', 'x')`, [X.tenantId, d7])));
    expect(bad).toMatch(/does not match source class/);
    await withTenant(pool, X.tenantId, (c) => c.query(
      `insert into derived_item (tenant_id, bid_item_id, data_class, kind, content) values ($1, $2, 'D9', 't', 'x')`, [X.tenantId, d7]));
  });
  it("audit, approvals, openings and calculation runs are append-only", async () => {
    const ev = await makeEvent(admin, X, "commercial_evaluation");
    for (const table of ["opening_record", "calculation_run"]) {
      expect(await fails(withTenant(pool, X.tenantId, (c) => c.query(`delete from ${table} where event_id = $1`, [ev.id])))).toMatch(/immutable/);
    }
    await withTenant(pool, X.tenantId, (c) => c.query(`insert into audit_event (tenant_id, action) values ($1, 'x')`, [X.tenantId]));
    expect(await fails(withTenant(pool, X.tenantId, (c) => c.query(`delete from audit_event`)))).toMatch(/immutable/);
  });
  it("separation of duties is enforced when roles are assigned", async () => {
    const ev = await makeEvent(admin, X, "draft");
    const add = (who: keyof World["people"], role: string) => admin.query(
      `insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1, $2, $3, $4)`, [X.tenantId, ev.id, X.people[who].membershipId, role]);
    expect(await fails(add("techA", "comm_evaluator"))).toMatch(/separation of duties/); // technical and commercial evaluator
    expect(await fails(add("buyer", "award_approver"))).toMatch(/separation of duties/); // buyer approving own event
    expect(await fails(add("techA", "tech_approver"))).toMatch(/separation of duties/); // evaluator approving own result
    expect(await fails(add("techA", "witness"))).toMatch(/separation of duties/);
  });
});
