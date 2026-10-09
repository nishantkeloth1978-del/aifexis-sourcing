import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { feedbackForSupplier, getJourney, recordExtension, releaseFeedback, setQuoteValidity, validUntil, validityForSupplier } from "@/journey/service";
import type { Who } from "@/events/service";
import type { SupplierWho } from "@/suppliers/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role: "member" } as Who);
const sup = (i: number): SupplierWho => ({ tenantId: X.tenantId, supplierId: X.suppliers[i]!.id, supplierUserId: "u", supplierName: "S", tenantName: "T", email: "e@x.com" });
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "jrny"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("quote validity", () => {
  it("adds days to the closing date", () => {
    expect(validUntil("2026-12-01T00:00:00Z", 90)).toBe("2027-03-01");
    expect(validUntil(null, 90)).toBeNull();
    expect(validUntil("2026-12-01T00:00:00Z", null)).toBeNull();
  });
  it("is set by the buyer, flags expired quotes and records extensions", async () => {
    const e = await makeEvent(admin, X, "commercial_evaluation", { closesAt: new Date(Date.now() - 100 * 86400000).toISOString() });
    expect(await setQuoteValidity(pool, who("comm"), e.id, 90)).toMatchObject({ ok: false });
    expect(await setQuoteValidity(pool, who("buyer"), e.id, 0)).toMatchObject({ ok: false });
    expect(await setQuoteValidity(pool, who("buyer"), e.id, 60)).toMatchObject({ ok: true });
    let j = (await getJourney(pool, who("buyer"), e.id))!;
    expect(j.validityDays).toBe(60);
    expect(j.bidders.length).toBe(3);
    expect(j.bidders.every((b) => b.expired)).toBe(true);                 // closed 100 days ago, valid for 60
    const s0 = X.suppliers[0]!.id;
    const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    expect(await recordExtension(pool, who("buyer"), e.id, s0, "nope")).toMatchObject({ ok: false });
    expect(await recordExtension(pool, who("buyer"), e.id, s0, future)).toMatchObject({ ok: true });
    j = (await getJourney(pool, who("buyer"), e.id))!;
    expect(j.bidders.find((b) => b.supplierId === s0)).toMatchObject({ until: future, extended: true, expired: false });
    expect(await validityForSupplier(pool, sup(0), e.id)).toBe(future);
    expect(await getJourney(pool, who("requester"), e.id)).toBeNull();     // requester has no commercial role
  });
});

describe("feedback to unsuccessful bidders", () => {
  it("is offered only after the award, never to the winner, and visible only to its supplier", async () => {
    const e = await makeEvent(admin, X, "awarded");
    const [w, l1, l2] = [X.suppliers[0]!.id, X.suppliers[1]!.id, X.suppliers[2]!.id];
    await admin.query(`insert into recommendation (tenant_id, event_id, supplier_id, note, created_by) values ($1,$2,$3,'Best weighted score overall',$4)`, [X.tenantId, e.id, w, X.people.buyer.membershipId]);
    const j = (await getJourney(pool, who("buyer"), e.id))!;
    expect(j.debriefs.map((d) => d.supplierId).sort()).toEqual([l1, l2].sort());
    expect(j.debriefs[0]!.suggested).toContain("Thank you for bidding");
    expect(await releaseFeedback(pool, who("comm"), e.id, l1, "Thank you for your participation.")).toMatchObject({ ok: false });
    expect(await releaseFeedback(pool, who("buyer"), e.id, w, "Thank you for your participation.")).toMatchObject({ ok: false });
    expect(await releaseFeedback(pool, who("buyer"), e.id, l1, "short")).toMatchObject({ ok: false });
    expect(await releaseFeedback(pool, who("buyer"), e.id, l1, "Thank you for your participation.")).toMatchObject({ ok: true });
    expect(await feedbackForSupplier(pool, sup(1), e.id)).toMatchObject({ message: "Thank you for your participation." });
    expect(await feedbackForSupplier(pool, sup(2), e.id)).toBeNull();
    expect(await feedbackForSupplier(pool, sup(0), e.id)).toBeNull();
    const open = await makeEvent(admin, X, "commercial_evaluation");
    expect(await releaseFeedback(pool, who("buyer"), open.id, l1, "Thank you for your participation.")).toMatchObject({ ok: false });
  });
});
