import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addAssumption, deleteAssumption, extraOf, setAssumptionValue } from "@/commercial/assumptions";
import { getCommercialView, openCommercialEnvelopes, recordRecommendation } from "@/commercial/service";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role: "member" } as Who);
const ver = async (id: string) => (await admin.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "assum"); });
afterAll(async () => { await pool.end(); await admin.end(); });

async function opened(totals: string[]) {
  const e = await makeEvent(admin, X, "technical_approved", { withBids: false });
  await admin.query(`delete from tech_result where event_id = $1`, [e.id]);
  await admin.query(`delete from qualified_bidder where event_id = $1`, [e.id]);
  for (const [i, t] of totals.entries()) {
    const rev = (await admin.query(`insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key) values ($1,$2,$3,1,$4) returning id`, [X.tenantId, e.id, X.suppliers[i]!.id, randomUUID()])).rows[0].id;
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D7','price_lines',$3)`, [X.tenantId, rev, JSON.stringify({ currency: "AED", total: t, lines: [] })]);
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D6','technical_response',$3)`, [X.tenantId, rev, JSON.stringify({ text: "tech" })]);
    await admin.query(`insert into tech_result (tenant_id, event_id, supplier_id, total, qualified) values ($1,$2,$3,$4,true)`, [X.tenantId, e.id, X.suppliers[i]!.id, 80]);
    await admin.query(`insert into qualified_bidder (tenant_id, event_id, supplier_id) values ($1,$2,$3)`, [X.tenantId, e.id, X.suppliers[i]!.id]);
  }
  await openCommercialEnvelopes(pool, who("buyer"), e.id, await ver(e.id), X.people.witness.membershipId);
  return e.id;
}

describe("evaluation assumptions", () => {
  it("rounds percentages half up", () => {
    expect(extraOf("pct", "10", 100000n)).toBe(10000n);
    expect(extraOf("pct", "2.5", 33333n)).toBe(833n);   // 833.325 -> 833
    expect(extraOf("amount", "12.5", 0n)).toBe(1250n);
  });
  it("changes the ranking and blocks the recommendation until complete", async () => {
    const id = await opened(["1000.00", "1100.00"]);
    const [s1, s2] = [X.suppliers[0]!.id, X.suppliers[1]!.id];
    expect(await addAssumption(pool, who("techA"), id, { label: "Freight", kind: "pct" })).toMatchObject({ ok: false });
    expect(await addAssumption(pool, who("buyer"), id, { label: "x", kind: "pct" })).toMatchObject({ ok: false });
    expect(await addAssumption(pool, who("buyer"), id, { label: "Freight", kind: "pct" })).toMatchObject({ ok: true });
    expect(await addAssumption(pool, who("buyer"), id, { label: "Freight", kind: "pct" })).toMatchObject({ ok: false });
    let v = (await getCommercialView(pool, who("buyer"), id))!;
    const a = v.comparison!.assumptions![0]!;
    expect(v.comparison!.missing!.length).toBe(2);
    expect(await recordRecommendation(pool, who("buyer"), id, await ver(id), s1, "Best weighted score of all bids")).toMatchObject({ ok: false });
    expect(await setAssumptionValue(pool, who("buyer"), id, a.id, s1, "-5")).toMatchObject({ ok: false });
    expect(await setAssumptionValue(pool, who("buyer"), id, a.id, s1, "20")).toMatchObject({ ok: true });
    expect(await setAssumptionValue(pool, who("buyer"), id, a.id, s2, "0")).toMatchObject({ ok: true });
    v = (await getCommercialView(pool, who("buyer"), id))!;
    expect(v.comparison!.missing).toEqual([]);
    const rows = v.comparison!.rows;
    expect(rows[0]!.supplierId).toBe(s2);                       // 1100 beats 1000 + 20% = 1200
    expect(rows.find((r) => r.supplierId === s1)).toMatchObject({ bid: "1000.00", total: "1200.00", extras: [{ label: "Freight", amount: "200.00" }] });
    expect(await recordRecommendation(pool, who("buyer"), id, await ver(id), s2, "Best weighted score of all bids")).toMatchObject({ ok: true });
    expect(await addAssumption(pool, who("buyer"), id, { label: "Late", kind: "amount" })).toMatchObject({ ok: false });   // state moved on
    expect(await deleteAssumption(pool, who("buyer"), id, a.id)).toMatchObject({ ok: false });
  });
  it("removes an assumption and rejects non-qualified suppliers", async () => {
    const id = await opened(["500.00"]);
    await addAssumption(pool, who("comm"), id, { label: "Warranty", kind: "amount" });
    const a = (await getCommercialView(pool, who("buyer"), id))!.comparison!.assumptions![0]!;
    expect(await setAssumptionValue(pool, who("buyer"), id, a.id, X.suppliers[2]!.id, "5")).toMatchObject({ ok: false });
    expect(await deleteAssumption(pool, who("buyer"), id, a.id)).toMatchObject({ ok: true });
    expect((await getCommercialView(pool, who("buyer"), id))!.comparison!.assumptions).toBeUndefined();
  });
});
