import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CRITERIA, approveTechnical, closeBidding, getEvalView, openTechnicalEnvelopes, saveScores } from "@/evaluation/service";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"], role = "member"): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role } as Who);
const full = (n: number) => Object.fromEntries(CRITERIA.map((k) => [k, n]));

beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "evalt"); });
afterAll(async () => { await pool.end(); await admin.end(); });

async function published() {
  const e = await makeEvent(admin, X, "published", { closesAt: new Date(Date.now() - 1000).toISOString() });
  const v = (await admin.query(`select state_version from sourcing_event where id = $1`, [e.id])).rows[0].state_version as number;
  return { id: e.id, v };
}

describe("close, open, score, approve", () => {
  it("runs the technical stage end to end, and keeps the technical text sealed until opening", async () => {
    const { id, v } = await published();
    expect((await getEvalView(pool, who("buyer"), id))!).toMatchObject({ bidderCount: 3, bidders: null });
    expect(await closeBidding(pool, who("techA"), id, v)).toMatchObject({ ok: false });
    expect(await closeBidding(pool, who("buyer"), id, v)).toMatchObject({ ok: true });
    expect(await openTechnicalEnvelopes(pool, who("buyer"), id, v + 1, X.people.techA.membershipId)).toMatchObject({ ok: false });   // not a witness
    expect((await getEvalView(pool, who("buyer"), id))!.bidders).toBeNull();
    expect(await openTechnicalEnvelopes(pool, who("buyer"), id, v + 1, X.people.witness.membershipId)).toMatchObject({ ok: true });

    const view = (await getEvalView(pool, who("techA"), id))!;
    expect(view.bidders).toHaveLength(3);
    expect(JSON.stringify(view)).not.toContain("price_total"); // prices are never part of the technical view

    expect(await saveScores(pool, who("buyer"), id, view.bidders![0]!.supplierId, full(8))).toMatchObject({ ok: false });
    expect(await saveScores(pool, who("techA"), id, view.bidders![0]!.supplierId, { ...full(8), [CRITERIA[0]]: 11 })).toMatchObject({ ok: false });
    // approval is refused until every evaluator has scored every bidder
    const approverV = (await admin.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;
    const ids = view.bidders!.map((b) => b.supplierId);
    expect(await approveTechnical(pool, who("techApprover"), id, approverV, ids)).toMatchObject({ ok: false, error: expect.stringContaining("has not finished") });
    for (const p of ["techA", "techB"] as const) for (const [i, b] of view.bidders!.entries()) expect(await saveScores(pool, who(p), id, b.supplierId, full(9 - i * 2))).toMatchObject({ ok: true });

    const av = (await getEvalView(pool, who("techApprover"), id))!;
    expect(av.results!.map((r) => [r.total, r.suggested])).toEqual([[90, true], [70, true], [50, false]]);
    expect(await approveTechnical(pool, who("buyer"), id, approverV, ids)).toMatchObject({ ok: false });
    expect(await approveTechnical(pool, who("techApprover"), id, approverV, [])).toMatchObject({ ok: false });
    expect(await approveTechnical(pool, who("techApprover"), id, approverV, ids.slice(0, 2))).toMatchObject({ ok: true });
    const after = (await getEvalView(pool, who("buyer"), id))!;
    expect(after.state).toBe("technical_approved");
    expect(after.results!.map((r) => r.qualified)).toEqual([true, true, false]);
  });
});
