import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addItem, duplicateEvent, getEvent, updateItemDetails, type Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"], role = "member"): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role } as Who);
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "itemdet"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("line details", () => {
  it("stores specification, required date, material group and target price, validates them, and copies them with the event", async () => {
    const id = (await makeEvent(admin, X, "draft", { withBids: false })).id;
    const a = await addItem(pool, who("buyer"), id, { description: "Pump", quantity: "2", unit: "EA" });
    if (!a.ok) throw new Error(a.error);
    const d = { specification: "ISO 5199, 316 SS", requiredDate: "2027-03-01", materialGroup: "Pumps", targetPrice: "1500.5" };
    const r = await updateItemDetails(pool, who("buyer"), id, a.item.id, d);
    expect(r).toMatchObject({ ok: true, item: { specification: "ISO 5199, 316 SS", requiredDate: "2027-03-01", materialGroup: "Pumps", targetPrice: "1500.5000" } });
    expect((await getEvent(pool, who("buyer"), id))!.items[0]).toMatchObject({ materialGroup: "Pumps", requiredDate: "2027-03-01" });
    expect(await updateItemDetails(pool, who("buyer"), id, a.item.id, { ...d, requiredDate: "31/12/2027" })).toMatchObject({ ok: false });
    expect(await updateItemDetails(pool, who("buyer"), id, a.item.id, { ...d, targetPrice: "-5" })).toMatchObject({ ok: false });
    expect(await updateItemDetails(pool, who("buyer"), id, a.item.id, { ...d, materialGroup: "x".repeat(61) })).toMatchObject({ ok: false });
    expect(await updateItemDetails(pool, who("buyer"), id, "00000000-0000-0000-0000-000000000000", d)).toMatchObject({ ok: false });
    const copy = await duplicateEvent(pool, who("buyer"), id);
    if (!copy.ok) throw new Error(copy.error);
    expect((await getEvent(pool, who("buyer"), copy.id))!.items[0]).toMatchObject({ specification: "ISO 5199, 316 SS", targetPrice: "1500.5000" });
    const cleared = await updateItemDetails(pool, who("buyer"), id, a.item.id, { specification: "", requiredDate: "", materialGroup: "", targetPrice: "" });
    expect(cleared).toMatchObject({ ok: true, item: { specification: null, targetPrice: null } });
  });
  it("locks once the event is no longer a draft", async () => {
    const e = await makeEvent(admin, X, "published", { withBids: false });
    const items = (await admin.query(`select id from event_item where event_id = $1 limit 1`, [e.id])).rows;
    if (items[0]) expect(await updateItemDetails(pool, who("buyer"), e.id, items[0].id, { specification: "x", requiredDate: "", materialGroup: "", targetPrice: "" })).toMatchObject({ ok: false });
  });
});

import { deleteDraftEvent, listEvents } from "@/events/service";
describe("deleting a draft event", () => {
  it("hides it from the app, keeps the audit trail, and refuses non-drafts and other people's drafts", async () => {
    const id = (await makeEvent(admin, X, "draft", { withBids: false })).id;
    expect(await deleteDraftEvent(pool, who("buyer", "viewer"), id)).toMatchObject({ ok: false });
    expect(await deleteDraftEvent(pool, who("buyer"), id)).toMatchObject({ ok: false });            // not the creator, not an administrator
    expect(await deleteDraftEvent(pool, who("admin", "admin"), id)).toMatchObject({ ok: true });
    expect(await getEvent(pool, who("buyer"), id)).toBeNull();
    expect(await deleteDraftEvent(pool, who("admin", "admin"), id)).toMatchObject({ ok: false, error: "Event not found." });
    expect((await admin.query(`select count(*)::int n from audit_event where event_id = $1 and action = 'event.deleted'`, [id])).rows[0].n).toBe(1);
    const pub = await makeEvent(admin, X, "published", { withBids: false });
    expect(await deleteDraftEvent(pool, who("admin", "admin"), pub.id)).toMatchObject({ ok: false, error: expect.stringContaining("Only a draft") });
  });
});
