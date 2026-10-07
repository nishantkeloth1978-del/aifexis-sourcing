import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client, Pool } from "pg";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";
import { createEvent, listEvents, validate, type Who } from "@/events/service";

let admin: Client, pool: Pool, X: World, Y: World;
const who = (w: World, role = "admin"): Who => ({ tenantId: w.tenantId, userId: w.people.admin.userId, membershipId: w.people.admin.membershipId, role });

beforeAll(async () => {
  admin = await adminClient(); pool = makePool(10);
  X = await seedTenant(admin, "EVX"); Y = await seedTenant(admin, "EVY");
});
afterAll(async () => { await pool.end(); await admin.end(); });

describe("events: create and list", () => {
  it("creates a draft with a reference, a requester and an audit record", async () => {
    const r = await createEvent(pool, who(X), { title: "  Pump set  ", ownerDept: "Procurement", closesAt: "2030-01-31" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.state).toBe("draft");
    expect(r.event.title).toBe("Pump set");
    expect(r.event.ref).toMatch(/^EV-\d{4}-\d{3}$/);
    const m = await admin.query("select event_role from event_member where event_id = $1", [r.event.id]);
    expect(m.rows.map((x) => x.event_role)).toEqual(["requester"]);
    const a = await admin.query("select 1 from audit_event where event_id = $1 and action = 'event.created'", [r.event.id]);
    expect(a.rowCount).toBe(1);
  });
  it("20 simultaneous creations get 20 distinct, gap-free references", async () => {
    const before = (await listEvents(pool, who(X))).length;
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => createEvent(pool, who(X), { title: `Parallel ${i}` })));
    const refs = rs.map((r) => (r.ok ? r.event.ref : "FAIL"));
    expect(new Set(refs).size).toBe(20);
    expect(refs).not.toContain("FAIL");
    const nums = refs.map((r) => Number(r.slice(-3))).sort((a, b) => a - b);
    expect(nums[19]! - nums[0]!).toBe(19);
    expect((await listEvents(pool, who(X))).length).toBe(before + 20);
  });
  it("a tenant never lists another tenant's events", async () => {
    await createEvent(pool, who(Y), { title: "Y secret event" });
    const xs = await listEvents(pool, who(X));
    expect(xs.some((e) => e.title === "Y secret event")).toBe(false);
    expect((await listEvents(pool, who(Y))).some((e) => e.title === "Y secret event")).toBe(true);
  });
  it("references restart per tenant", async () => {
    const y = await listEvents(pool, who(Y));
    expect(y.map((e) => e.ref)).toContain(`EV-${new Date().getUTCFullYear()}-001`);
  });
  it("rejects bad input and roles that may not create", async () => {
    expect((await createEvent(pool, who(X), { title: "ab" })).ok).toBe(false);
    expect((await createEvent(pool, who(X), { title: "x".repeat(201) })).ok).toBe(false);
    expect((await createEvent(pool, who(X), { title: "Fine title", closesAt: "not a date" })).ok).toBe(false);
    expect((await createEvent(pool, who(X, "integration_admin"), { title: "Nope nope" })).ok).toBe(false);
  });
  it("validate trims and normalises", () => {
    const v = validate({ title: " Abc ", ownerDept: " HSE ", closesAt: "" });
    expect(v).toEqual({ ok: true, value: { title: "Abc", ownerDept: "HSE", closesAt: null } });
  });
});
