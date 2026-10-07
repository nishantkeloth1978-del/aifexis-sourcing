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

import { addItem, deleteItem, getEvent, updateEventBasics } from "@/events/service";

describe("events: line items", () => {
  const mk = async (w: World) => { const r = await createEvent(pool, who(w), { title: "Items test event" }); if (!r.ok) throw new Error("setup"); return r.event; };
  const item = { description: "Pump API 610", quantity: "2", unit: "EA" };

  it("adds items in order and shows them on the event", async () => {
    const e = await mk(X);
    const a = await addItem(pool, who(X), e.id, item); const b = await addItem(pool, who(X), e.id, { ...item, description: "Spare seal kit", quantity: "10.5" });
    expect(a.ok && b.ok).toBe(true);
    const d = await getEvent(pool, who(X), e.id);
    expect(d?.items.map((i) => i.lineNo)).toEqual([1, 2]);
    expect(d?.items[1]?.quantity).toBe("10.500");
  });
  it("15 simultaneous additions get distinct line numbers", async () => {
    const e = await mk(X);
    const rs = await Promise.all(Array.from({ length: 15 }, (_, i) => addItem(pool, who(X), e.id, { ...item, description: `Item ${i}` })));
    expect(rs.every((r) => r.ok)).toBe(true);
    const d = await getEvent(pool, who(X), e.id);
    expect(d?.items.map((i) => i.lineNo)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });
  it("rejects bad quantities, units and descriptions", async () => {
    const e = await mk(X);
    for (const bad of [{ ...item, quantity: "0" }, { ...item, quantity: "-1" }, { ...item, quantity: "abc" }, { ...item, quantity: "1.2345" },
      { ...item, unit: "" }, { ...item, description: "  " }, { ...item, description: "x".repeat(501) }]) {
      expect((await addItem(pool, who(X), e.id, bad)).ok).toBe(false);
    }
  });
  it("deletes an item; edits stop once the event is no longer a draft", async () => {
    const e = await mk(X);
    const a = await addItem(pool, who(X), e.id, item); if (!a.ok) throw new Error("setup");
    expect((await deleteItem(pool, who(X), e.id, a.item.id)).ok).toBe(true);
    expect((await getEvent(pool, who(X), e.id))?.items).toHaveLength(0);
    await admin.query("update sourcing_event set state = 'published' where id = $1", [e.id]);
    expect((await addItem(pool, who(X), e.id, item)).ok).toBe(false);
    expect((await updateEventBasics(pool, who(X), e.id, { title: "Changed title" })).ok).toBe(false);
    // the database itself also refuses, even if the application layer were bypassed
    await expect(admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit) values ($1, $2, 99, 'x', 1, 'EA')`, [X.tenantId, e.id])).rejects.toThrow(/draft/);
  });
  it("another tenant can neither read nor change the event", async () => {
    const e = await mk(X);
    expect(await getEvent(pool, who(Y), e.id)).toBeNull();
    const r = await addItem(pool, who(Y), e.id, item);
    expect(r.ok).toBe(false);
    expect((await getEvent(pool, who(X), e.id))?.items).toHaveLength(0);
  });
  it("updates title, department and closing date while draft", async () => {
    const e = await mk(X);
    const r = await updateEventBasics(pool, who(X), e.id, { title: "Renamed event", ownerDept: "HSE", closesAt: "2031-02-01" });
    expect(r.ok && r.event.title).toBe("Renamed event");
  });
  it("rejects malformed ids without touching the database", async () => {
    expect(await getEvent(pool, who(X), "not-a-uuid'; drop table x;--")).toBeNull();
  });
});
