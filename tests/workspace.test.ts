import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteItems, getEvent, listActivity, updateItemCore, addItem } from "@/events/service";
import { workspaceOf } from "@/events/readiness";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role: "admin" } as Who);
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "wksp"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("workspace readiness", () => {
  const base = { state: "draft", title: "Pumps", closesAt: null, itemCount: 0, itemsWithLots: true, lotsNeeded: false, teamRoles: [], myRoles: ["buyer"] as never[], isAdmin: true, docCount: 0 };
  it("lists the draft tasks and the first missing one as next", () => {
    const w = workspaceOf(base);
    expect(w.ready).toBe(false);
    expect(w.next).toBe("Set a closing date");
    const ok = workspaceOf({ ...base, closesAt: "2026-12-01", itemCount: 2, teamRoles: ["buyer", "publication_approver"] });
    expect(ok.ready).toBe(true);
    expect(ok.next).toBe("Submit the event for publication approval");
    expect(ok.tasks.find((t) => t.key === "docs")).toMatchObject({ required: false, done: false });
  });
  it("requires lots when the event uses them", () => {
    expect(workspaceOf({ ...base, closesAt: "2026-12-01", itemCount: 1, lotsNeeded: true, itemsWithLots: false }).next).toBe("Put every item in a lot");
  });
  it("names the next action for later states and waits for others", () => {
    expect(workspaceOf({ ...base, state: "published" }).next).toBe("Invite suppliers and answer clarification questions");
    expect(workspaceOf({ ...base, state: "pending_award", myRoles: [] }).next).toMatch(/^Waiting for/);
  });
});

describe("inline edit, bulk delete, activity", () => {
  it("edits a line, deletes several, and records activity", async () => {
    const e = await makeEvent(admin, X, "draft", { withBids: false });
    const a = await addItem(pool, who("buyer"), e.id, { description: "Pump", quantity: "2", unit: "EA" });
    const b = await addItem(pool, who("buyer"), e.id, { description: "Valve", quantity: "5", unit: "EA" });
    const c = await addItem(pool, who("buyer"), e.id, { description: "Seal", quantity: "9", unit: "EA" });
    if (!a.ok || !b.ok || !c.ok) throw new Error("setup");
    expect(await updateItemCore(pool, who("buyer"), e.id, a.item.id, { description: "Pump 5kW", quantity: "3.5", unit: "EA" })).toMatchObject({ ok: true, item: { description: "Pump 5kW", quantity: "3.500" } });
    expect(await updateItemCore(pool, who("buyer"), e.id, a.item.id, { description: "", quantity: "3", unit: "EA" })).toMatchObject({ ok: false });
    expect(await deleteItems(pool, who("buyer"), e.id, [])).toMatchObject({ ok: false });
    expect(await deleteItems(pool, who("buyer"), e.id, [b.item.id, c.item.id])).toMatchObject({ ok: true, count: 2 });
    expect((await getEvent(pool, who("buyer"), e.id))!.items.map((i) => i.description)).toEqual(["Pump 5kW"]);
    const act = await listActivity(pool, who("buyer"), e.id);
    expect(act.map((x) => x.action)).toEqual(expect.arrayContaining(["item.added", "item.edited", "item.deleted"]));
    await admin.query(`update sourcing_event set state = 'published' where id = $1`, [e.id]).catch(() => undefined);
  });
  it("refuses edits once the event is no longer a draft", async () => {
    const e = await makeEvent(admin, X, "published", { withBids: false });
    const it = (await admin.query(`select id from event_item where event_id = $1 limit 1`, [e.id])).rows[0];
    if (it) expect(await updateItemCore(pool, who("buyer"), e.id, it.id, { description: "x", quantity: "1", unit: "EA" })).toMatchObject({ ok: false });
    expect(await deleteItems(pool, who("buyer"), e.id, [it?.id ?? "00000000-0000-0000-0000-000000000000"])).toMatchObject({ ok: false });
  });
});
