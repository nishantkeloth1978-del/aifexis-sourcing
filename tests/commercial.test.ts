import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveAwardNow, getCommercialView, openCommercialEnvelopes, recordRecommendation, rejectAward, submitForAward } from "@/commercial/service";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role: "member" } as Who);
const ver = async (id: string) => (await admin.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;

beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "comm"); });
afterAll(async () => { await pool.end(); await admin.end(); });

async function approvedEvent(totals: string[]) {
  const e = await makeEvent(admin, X, "technical_approved", { withBids: false });
  await admin.query(`delete from tech_result where event_id = $1`, [e.id]);
  await admin.query(`delete from qualified_bidder where event_id = $1`, [e.id]);
  for (const [i, t] of totals.entries()) {
    const rev = (await admin.query(`insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key) values ($1,$2,$3,1,$4) returning id`, [X.tenantId, e.id, X.suppliers[i]!.id, randomUUID()])).rows[0].id;
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D7','price_lines',$3)`, [X.tenantId, rev, JSON.stringify({ currency: "AED", total: t, lines: [] })]);
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D6','technical_response',$3)`, [X.tenantId, rev, JSON.stringify({ text: "tech" })]);
    await admin.query(`insert into tech_result (tenant_id, event_id, supplier_id, total, qualified) values ($1,$2,$3,$4,$5)`, [X.tenantId, e.id, X.suppliers[i]!.id, [90, 80, 60][i], i < 2]);
  }
  for (const i of [0, 1]) await admin.query(`insert into qualified_bidder (tenant_id, event_id, supplier_id) values ($1,$2,$3)`, [X.tenantId, e.id, X.suppliers[i]!.id]);
  return e.id;
}

describe("commercial opening, ranking, recommendation, award", () => {
  it("runs the whole commercial stage", async () => {
    const id = await approvedEvent(["1000.00", "800.00", "500.00"]);
    expect(await getCommercialView(pool, who("buyer"), id)).toMatchObject({ comparison: null });          // sealed until opened
    expect(await openCommercialEnvelopes(pool, who("buyer"), id, await ver(id), X.people.techA.membershipId)).toMatchObject({ ok: false });
    expect(await openCommercialEnvelopes(pool, who("buyer"), id, await ver(id), X.people.witness.membershipId)).toMatchObject({ ok: true });

    const v = (await getCommercialView(pool, who("buyer"), id))!;
    // supplier 3 (cheapest, 500) was not qualified and does not appear. S1: 90, 80.00 -> 0.3*90+0.7*80 = 83.00; S2: 80, 100.00 -> 94.00
    expect(v.comparison!.rows.map((r) => [r.rank, r.commercial, r.final])).toEqual([[1, "100.00", "94.00"], [2, "80.00", "83.00"]]);
    expect(v.comparison!.closeResult).toBe(false);
    expect(JSON.stringify(v)).not.toContain("500.00");
    expect(await getCommercialView(pool, who("awardApprover"), id)).toMatchObject({ comparison: null });   // approver cannot read prices yet

    const [s1, s2] = [X.suppliers[0]!.id, X.suppliers[1]!.id];
    expect(await recordRecommendation(pool, who("buyer"), id, await ver(id), s2, "short")).toMatchObject({ ok: false });
    expect(await recordRecommendation(pool, who("buyer"), id, await ver(id), X.suppliers[2]!.id, "Lowest price overall of all")).toMatchObject({ ok: false });
    expect(await recordRecommendation(pool, who("comm"), id, await ver(id), s2, "Best weighted score of all bids")).toMatchObject({ ok: false });
    expect(await recordRecommendation(pool, who("buyer"), id, await ver(id), s2, "Best weighted score of all bids")).toMatchObject({ ok: true });
    expect(await submitForAward(pool, who("buyer"), id, await ver(id))).toMatchObject({ ok: true });

    const a = (await getCommercialView(pool, who("awardApprover"), id))!;
    expect(a).toMatchObject({ stored: true, recommendation: { supplierId: s2 } });
    expect(a.comparison!.rows[0]!.name).toBeTruthy();
    expect(await approveAwardNow(pool, who("buyer"), id, await ver(id))).toMatchObject({ ok: false });
    expect(await rejectAward(pool, who("awardApprover"), id, await ver(id))).toMatchObject({ ok: true });
    expect((await getCommercialView(pool, who("buyer"), id))!.state).toBe("recommended");
    expect(s1).toBeTruthy();
  });
  it("approves the award and is idempotent per approver", async () => {
    const id = await approvedEvent(["900.00", "1000.00", "700.00"]);
    await openCommercialEnvelopes(pool, who("buyer"), id, await ver(id), X.people.witness.membershipId);
    await recordRecommendation(pool, who("buyer"), id, await ver(id), X.suppliers[0]!.id, "Best weighted score of all bids");
    await submitForAward(pool, who("buyer"), id, await ver(id));
    const v = await ver(id);
    expect(await approveAwardNow(pool, who("awardApprover"), id, v)).toMatchObject({ ok: true });
    expect(await approveAwardNow(pool, who("awardApprover"), id, v)).toMatchObject({ ok: true });
    const done = (await getCommercialView(pool, who("buyer"), id))!;
    expect(done.state).toBe("awarded");
    expect(done.approvals.done).toBe(1);
  });
});
