import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, saveConfig } from "@/config/service";
import { autoOn, autoRunFor, autopilotJudge, checkScores, runTechnicalAgent, totalOf, type DraftRow } from "@/evaluation/agent";
import { getEvalView, setAiTechEval } from "@/evaluation/service";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

const SOURCE = "We have delivered twelve similar pump packages in the GCC since 2019.\nAll units are tested to API 610 before shipment.";
const CRIT = ["Experience", "Quality", "Delivery"];

describe("checkScores", () => {
  it("keeps scores inside the band of their assessment and zeroes unsupported claims", () => {
    const d = checkScores({ findings: [
      { criterion: "Experience", assessment: "meets", score: 3, summary: "ok", quotes: ["delivered twelve similar pump packages in the GCC"] },
      { criterion: "Quality", assessment: "meets", score: 9, summary: "claims", quotes: ["made-up quote about ISO 9001 certification"] },
      { criterion: "Delivery", assessment: "partly", score: 9.5, summary: "p", quotes: ["tested to API 610 before shipment"] },
    ] }, CRIT, SOURCE);
    expect(d[0]).toMatchObject({ assessment: "meets", score: 7 });            // pulled up into the "meets" band
    expect(d[1]).toMatchObject({ assessment: "no_evidence", score: 0 });      // no verified quote
    expect(d[2]).toMatchObject({ assessment: "partly", score: 6.9 });         // pulled down into the "partly" band
  });
  it("copes with garbage and missing criteria", () => {
    expect(checkScores("nope", CRIT, SOURCE).every((x) => x.score === 0 && x.assessment === "no_evidence")).toBe(true);
  });
});

const row = (criterion: string, score: number, assessment: DraftRow["assessment"] = "meets"): DraftRow => ({ criterion, score, assessment, summary: "", quotes: [] });
describe("totals and Autopilot judgement", () => {
  it("weights the total like the evaluation screen", () => {
    const d = [row("A", 10), row("B", 0)];
    expect(totalOf(d, ["A", "B"])).toBe(50);
    expect(totalOf(d, ["A", "B"], [80, 20])).toBe(80);
  });
  it("qualifies clear passes, holds on thin evidence or a close score, and skips failed gates", () => {
    const good = [row("A", 9), row("B", 9)], close = [row("A", 7), row("B", 7)], thin = [row("A", 9), row("B", 0, "no_evidence")], low = [row("A", 2, "does_not_meet"), row("B", 2, "does_not_meet")];
    const j = (list: { name: string; gatesPassed?: boolean; drafts: DraftRow[] }[]) => autopilotJudge(list.map((b, i) => ({ supplierId: `s${i}`, name: b.name, gatesPassed: b.gatesPassed ?? true, drafts: b.drafts })), ["A", "B"], null, 70);
    expect(j([{ name: "G", drafts: good }, { name: "L", drafts: low }])).toMatchObject({ qualified: ["s0"], hold: null });
    expect(j([{ name: "C", drafts: close }]).hold).toMatch(/within 5 points of the pass mark/);
    expect(j([{ name: "T", drafts: thin }]).hold).toMatch(/no evidence/);
    expect(j([{ name: "F", gatesPassed: false, drafts: good }])).toMatchObject({ qualified: [], hold: null });
  });
  it("the event switch beats the company default, and nothing runs without the assistant being on", () => {
    expect(autoOn(null, { aiAssist: true, aiTechEvalAuto: true })).toBe(true);
    expect(autoOn(false, { aiAssist: true, aiTechEvalAuto: true })).toBe(false);
    expect(autoOn(true, { aiAssist: true })).toBe(true);
    expect(autoOn(true, { aiTechEvalAuto: true })).toBe(false);
  });
});

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"], role = "member"): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role } as Who);
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "techagent"); });
afterAll(async () => { await pool.end(); await admin.end(); });

const fakeAi = (reply: (body: string) => unknown, calls: string[] = []) => (async (_u: unknown, init?: RequestInit) => { const b = String(init?.body); calls.push(b); return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(reply(b)) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }); }) as unknown as typeof fetch;
const env = { ANTHROPIC_API_KEY: "test" } as unknown as NodeJS.ProcessEnv;
const claude = { key: "test", model: "test-model" };

/** A model that quotes the first words of whatever response it was given and scores each criterion 8. */
const quoting = (criteria: readonly string[]) => (body: string) => {
  const text = (JSON.parse(body).messages[0].content as string).split(/<response[^>]*>\n?/)[1]!.split("\n</response>")[0]!;
  return { findings: criteria.map((c) => ({ criterion: c, assessment: "meets", score: 8, summary: "ok", quotes: [text.slice(0, 25)] })) };
};

describe("technical evaluation agent", () => {
  it("drafts scores for every bidder as the buyer, stores them apart from real scores, and audits", async () => {
    await saveConfig(pool, who("admin", "admin"), { ...DEFAULT_CONFIG, aiAssist: true });
    const id = (await makeEvent(admin, X, "technical_evaluation")).id;
    const view = (await getEvalView(pool, who("buyer"), id))!;
    expect(view.agent).toMatchObject({ available: false });          // no key in this process: not offered
    const realBefore = (await admin.query(`select count(*)::int n from tech_score where event_id = $1`, [id])).rows[0].n as number;
    const r = await runTechnicalAgent(pool, who("buyer"), id, {}, { claude, fetch: fakeAi(quoting(view.criteria)) });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.runs).toHaveLength(view.bidders!.length);
    expect(r.runs.every((x) => x.ok && x.drafts.length === view.criteria.length && x.total === 80)).toBe(true);
    expect((await admin.query(`select count(*)::int n from tech_score_draft where event_id = $1`, [id])).rows[0].n).toBe(view.bidders!.length * view.criteria.length);
    expect((await admin.query(`select count(*)::int n from tech_score where event_id = $1`, [id])).rows[0].n).toBe(realBefore);   // the agent never saves real scores
    expect((await admin.query(`select count(*)::int n from audit_event where event_id = $1 and action = 'evaluation.agent_run'`, [id])).rows[0].n).toBe(view.bidders!.length);
    const again = await runTechnicalAgent(pool, who("techA"), id, { supplierId: view.bidders![0]!.supplierId }, { claude, fetch: fakeAi(quoting(view.criteria)) });
    expect(again).toMatchObject({ ok: true });
    expect((await admin.query(`select count(*)::int n from tech_score_draft where event_id = $1`, [id])).rows[0].n).toBe(view.bidders!.length * view.criteria.length);   // replaced, not duplicated
  });
  it("follows the company switch as it is now, not the configuration frozen when the event was published", async () => {
    await saveConfig(pool, who("admin", "admin"), { ...DEFAULT_CONFIG, aiAssist: true });
    const id = (await makeEvent(admin, X, "technical_evaluation")).id;
    await admin.query(`alter table sourcing_event disable trigger user`);
    await admin.query(`update sourcing_event set config_snapshot = $2::jsonb where id = $1`, [id, JSON.stringify({ evaluation: { ...DEFAULT_CONFIG } })]);   // published while the assistant was off
    await admin.query(`alter table sourcing_event enable trigger user`);
    const view = (await getEvalView(pool, who("buyer"), id))!;
    const r = await runTechnicalAgent(pool, who("buyer"), id, {}, { claude, fetch: fakeAi(quoting(view.criteria)) });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    await saveConfig(pool, who("admin", "admin"), { ...DEFAULT_CONFIG });
    expect(await runTechnicalAgent(pool, who("buyer"), id, {}, { claude, fetch: fakeAi(quoting(view.criteria)) })).toMatchObject({ ok: false });   // switched off again: stops at once
  });
  it("sends one bidder per request and refuses people who may not read the responses", async () => {
    await saveConfig(pool, who("admin", "admin"), { ...DEFAULT_CONFIG, aiAssist: true });
    const id = (await makeEvent(admin, X, "technical_evaluation")).id;
    const view = (await getEvalView(pool, who("buyer"), id))!;
    const calls: string[] = [];
    await runTechnicalAgent(pool, who("buyer"), id, {}, { claude, fetch: fakeAi(quoting(view.criteria), calls) });
    expect(calls).toHaveLength(view.bidders!.length);
    for (const c of calls) { const others = view.bidders!.filter((b) => !c.includes(b.technicalText.slice(0, 40))); expect(others.length).toBeGreaterThan(0); }
    expect(await runTechnicalAgent(pool, who("comm"), id, {}, { claude, fetch: fakeAi(quoting(view.criteria)) })).toMatchObject({ ok: false });
    expect(await runTechnicalAgent(pool, who("witness"), id, {}, { claude, fetch: fakeAi(quoting(view.criteria)) })).toMatchObject({ ok: false });
  });
  it("refuses when the assistant is off, before the envelopes open, or after the result is approved", async () => {
    await saveConfig(pool, who("admin", "admin"), { ...DEFAULT_CONFIG });
    const id = (await makeEvent(admin, X, "technical_evaluation")).id;
    expect(await runTechnicalAgent(pool, who("buyer"), id, {}, { claude, fetch: fakeAi(() => ({ findings: [] })) })).toMatchObject({ ok: false, error: expect.stringContaining("not switched on") });
    await saveConfig(pool, who("admin", "admin"), { ...DEFAULT_CONFIG, aiAssist: true });
    const closed = (await makeEvent(admin, X, "closed")).id;
    expect(await runTechnicalAgent(pool, who("buyer"), closed, {}, { claude, fetch: fakeAi(() => ({ findings: [] })) })).toMatchObject({ ok: false, error: expect.stringContaining("not in technical evaluation") });
  });
  it("the automatic run happens once, follows the event switch, and skips events with it off", async () => {
    await saveConfig(pool, who("admin", "admin"), { ...DEFAULT_CONFIG, aiAssist: true, aiTechEvalAuto: true });
    const a = (await makeEvent(admin, X, "technical_evaluation")).id;
    const calls: string[] = [];
    const view = (await getEvalView(pool, who("buyer"), a))!;
    const deps = { claude, fetch: fakeAi(quoting(view.criteria), calls) };
    expect(await autoRunFor(pool, X.tenantId, a, deps)).toBe("ran");
    expect(calls.length).toBeGreaterThan(0);
    const n = calls.length;
    expect(await autoRunFor(pool, X.tenantId, a, deps)).toBe("skipped");     // only once
    expect(calls).toHaveLength(n);
    const b = (await makeEvent(admin, X, "technical_evaluation")).id;
    expect((await setAiTechEval(pool, who("buyer"), b, false)).ok).toBe(true);
    expect(await autoRunFor(pool, X.tenantId, b, deps)).toBe("skipped");     // the event said no
    expect((await setAiTechEval(pool, who("techA"), b, true)).ok).toBe(false); // only the buyer or an administrator
    expect((await setAiTechEval(pool, who("admin", "admin"), b, null)).ok).toBe(true);
  });
});
