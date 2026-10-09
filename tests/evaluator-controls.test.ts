import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, saveConfig } from "@/config/service";
import { approveScoreChange, declareConflict, recordModeration } from "@/evaluation/controls";
import { approveTechnical, getEvalView, saveScores } from "@/evaluation/service";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"], role = "member"): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role } as Who);
const full = (n: number) => Object.fromEntries(DEFAULT_CONFIG.criteria.map((k) => [k, n]));
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "evctl"); });
afterAll(async () => { await pool.end(); await admin.end(); });

const setCfg = (extra: object) => saveConfig(pool, who("admin", "admin"), { ...DEFAULT_CONFIG, ...extra });
const ver = async (id: string) => (await admin.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;
async function evalEvent() { return (await makeEvent(admin, X, "technical_evaluation")).id; }

describe("conflict of interest declarations", () => {
  it("hides bids and blocks scoring until declared, and recuses an evaluator who declares a conflict", async () => {
    expect(await setCfg({ evaluatorDeclarations: true })).toMatchObject({ ok: true });
    const id = await evalEvent();
    expect((await getEvalView(pool, who("techA"), id))!).toMatchObject({ bidders: null, declaration: "none", declarationsRequired: true });
    const sup = X.suppliers[0].id;
    expect(await saveScores(pool, who("techA"), id, sup, full(8))).toMatchObject({ ok: false, error: expect.stringContaining("Declare") });
    expect(await declareConflict(pool, who("techA"), id, { conflict: true, detail: "" })).toMatchObject({ ok: false });
    expect(await declareConflict(pool, who("buyer"), id, { conflict: false, detail: "" })).toMatchObject({ ok: false });       // not an evaluator
    expect(await declareConflict(pool, who("techA"), id, { conflict: true, detail: "Brother works at the supplier" })).toMatchObject({ ok: true });
    expect(await declareConflict(pool, who("techA"), id, { conflict: false, detail: "" })).toMatchObject({ ok: false });         // final
    expect((await getEvalView(pool, who("techA"), id))!).toMatchObject({ bidders: null, declaration: "conflict" });
    expect(await saveScores(pool, who("techA"), id, sup, full(8))).toMatchObject({ ok: false, error: expect.stringContaining("conflict") });
    expect(await declareConflict(pool, who("techB"), id, { conflict: false, detail: "" })).toMatchObject({ ok: true });
    expect((await getEvalView(pool, who("techB"), id))!.bidders).toHaveLength(3);
    // the recused evaluator no longer has to score; the remaining one does
    const ids = X.suppliers.map((s) => s.id);
    for (const s of ids) expect(await saveScores(pool, who("techB"), id, s, full(8))).toMatchObject({ ok: true });
    expect(await approveTechnical(pool, who("techApprover"), id, await ver(id), ids)).toMatchObject({ ok: true });
    expect((await admin.query(`select count(*)::int n from audit_event where event_id = $1 and action = 'evaluator.recused'`, [id])).rows[0].n).toBe(1);
  });
  it("is off unless the company turns it on", async () => {
    await setCfg({ evaluatorDeclarations: false });
    const id = await evalEvent();
    expect((await getEvalView(pool, who("techA"), id))!.bidders).toHaveLength(3);
  });
});

describe("moderation of score differences and score changes", () => {
  it("blocks approval until a difference over the gap is explained", async () => {
    await setCfg({ evaluatorDeclarations: false, moderationGap: 20 });
    const id = await evalEvent(); const ids = X.suppliers.map((s) => s.id);
    for (const s of ids) { await saveScores(pool, who("techA"), id, s, full(8)); await saveScores(pool, who("techB"), id, s, full(8)); }
    const crit = DEFAULT_CONFIG.criteria[0]!;
    await saveScores(pool, who("techB"), id, ids[0]!, { ...full(8), [crit]: 5 }, "Re-read the proposal");           // 30 points apart
    const v = (await getEvalView(pool, who("techApprover"), id))!;
    expect(v.gaps).toEqual([expect.objectContaining({ supplierId: ids[0], criterion: crit, gap: 30, reason: null })]);
    expect((await getEvalView(pool, who("techA"), id))!.gaps).toBeNull();                                                 // evaluators do not see each other's difference
    expect(await approveTechnical(pool, who("techApprover"), id, await ver(id), ids)).toMatchObject({ ok: false, error: expect.stringContaining("Explain the score difference") });
    expect(await recordModeration(pool, who("techA"), id, ids[0]!, crit, "Because it is fine")).toMatchObject({ ok: false });
    expect(await recordModeration(pool, who("techApprover"), id, ids[0]!, crit, "no")).toMatchObject({ ok: false });
    expect(await recordModeration(pool, who("techApprover"), id, ids[1]!, crit, "No difference here")).toMatchObject({ ok: false });
    expect(await recordModeration(pool, who("techApprover"), id, ids[0]!, crit, "Evaluator B read the warranty annex")).toMatchObject({ ok: true });
    expect(await approveTechnical(pool, who("techApprover"), id, await ver(id), ids)).toMatchObject({ ok: true });
  });
  it("requires a reason to change a saved score and records old and new values", async () => {
    await setCfg({ moderationGap: 20 });
    const id = await evalEvent(); const sup = X.suppliers[0].id;
    expect(await saveScores(pool, who("techA"), id, sup, full(8))).toMatchObject({ ok: true });
    expect(await saveScores(pool, who("techA"), id, sup, full(7))).toMatchObject({ ok: false, error: expect.stringContaining("reason") });
    expect(await saveScores(pool, who("techA"), id, sup, full(7), "Corrected after clarification")).toMatchObject({ ok: true });
    const rows = (await admin.query(`select old_score::float8 o, new_score::float8 n, reason, material from score_change where event_id = $1`, [id])).rows;
    expect(rows).toHaveLength(DEFAULT_CONFIG.criteria.length);
    expect(rows[0]).toMatchObject({ o: 8, n: 7, reason: "Corrected after clarification", material: false });
    await expect(admin.query(`update score_change set new_score = 1 where event_id = $1`, [id])).rejects.toThrow(/cannot be edited/);
  });
  it("holds back approval of a material change until another person approves it", async () => {
    await setCfg({ moderationGap: 20, scoreChangeApproval: "second_person" });
    const id = await evalEvent(); const ids = X.suppliers.map((s) => s.id);
    for (const s of ids) { await saveScores(pool, who("techA"), id, s, full(8)); await saveScores(pool, who("techB"), id, s, full(8)); }
    expect(await saveScores(pool, who("techA"), id, ids[0]!, full(4), "Found a gap in the method statement")).toMatchObject({ ok: true });
    const pend = (await getEvalView(pool, who("techApprover"), id))!.pendingChanges!;
    expect(pend.length).toBeGreaterThan(0);
    expect(await approveTechnical(pool, who("techApprover"), id, await ver(id), ids)).toMatchObject({ ok: false });
    expect(await approveScoreChange(pool, who("techA"), id, pend[0]!.id)).toMatchObject({ ok: false });                  // not the approver
    for (const p of pend) expect(await approveScoreChange(pool, who("techApprover"), id, p.id)).toMatchObject({ ok: true });
    expect((await getEvalView(pool, who("techApprover"), id))!.pendingChanges).toEqual([]);
    for (const k of [true]) void k;
    await recordModeration(pool, who("techApprover"), id, ids[0]!, DEFAULT_CONFIG.criteria[0]!, "Explained in the minutes");
    for (const c of DEFAULT_CONFIG.criteria.slice(1)) await recordModeration(pool, who("techApprover"), id, ids[0]!, c, "Explained in the minutes");
    expect(await approveTechnical(pool, who("techApprover"), id, await ver(id), ids)).toMatchObject({ ok: true });
  });
});
