import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, saveConfig } from "@/config/service";
import { checkFindings, suggestFindings } from "@/evaluation/assist";
import { getEvalView } from "@/evaluation/service";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

const SOURCE = "We have delivered   twelve similar pump packages in the GCC since 2019.\nAll units are tested to API 610 before shipment.";
const CRIT = ["Experience", "Quality", "Delivery"];

describe("checkFindings", () => {
  it("keeps only quotes found in the response and downgrades unsupported claims", () => {
    const f = checkFindings({ findings: [
      { criterion: "Experience", assessment: "meets", summary: "Twelve similar packages.", quotes: ["delivered twelve similar pump packages in the GCC", "invented sentence that is not there"] },
      { criterion: "Quality", assessment: "meets", summary: "Claims quality.", quotes: ["made-up quote about ISO 9001 certification"] },
      { criterion: "Unknown", assessment: "meets", summary: "x", quotes: [] },
    ] }, CRIT, SOURCE);
    expect(f.map((x) => x.criterion)).toEqual(CRIT);
    expect(f[0]).toMatchObject({ assessment: "meets", droppedQuotes: 1 });
    expect(f[0]!.quotes).toEqual(["delivered twelve similar pump packages in the GCC"]);
    expect(f[1]).toMatchObject({ assessment: "no_evidence", quotes: [], droppedQuotes: 1 });
    expect(f[2]).toMatchObject({ assessment: "no_evidence" });
  });
  it("copes with garbage", () => {
    expect(checkFindings("nope", CRIT, SOURCE).every((x) => x.assessment === "no_evidence")).toBe(true);
    expect(checkFindings({ findings: [{ criterion: "Experience", assessment: "great", quotes: 5 }] }, CRIT, SOURCE)[0]!.assessment).toBe("no_evidence");
  });
});

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"], role = "member"): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role } as Who);
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "aiassist"); });
afterAll(async () => { await pool.end(); await admin.end(); });

const fakeAi = (reply: unknown, calls: { body: string }[] = []) => (async (_u: unknown, init?: RequestInit) => { calls.push({ body: String(init?.body) }); return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(reply) }] }), { status: 200 }); }) as unknown as typeof fetch;
const env = { ANTHROPIC_API_KEY: "test" } as unknown as NodeJS.ProcessEnv;

describe("AI review assistant", () => {
  it("is off until the company turns it on, and never runs for non-evaluators", async () => {
    await saveConfig(pool, who("admin", "admin"), { ...DEFAULT_CONFIG });
    const id = (await makeEvent(admin, X, "technical_evaluation")).id;
    const sup = X.suppliers[0].id;
    const calls: { body: string }[] = [];
    expect(await suggestFindings(pool, who("techA"), id, sup, { env, fetch: fakeAi({ findings: [] }, calls) })).toMatchObject({ ok: false, error: expect.stringContaining("not switched on") });
    expect(calls).toHaveLength(0);
    await saveConfig(pool, who("admin", "admin"), { ...DEFAULT_CONFIG, aiAssist: true });
    expect(await suggestFindings(pool, who("buyer"), id, sup, { env, fetch: fakeAi({ findings: [] }, calls) })).toMatchObject({ ok: false, error: expect.stringContaining("technical evaluator") });
    expect(calls).toHaveLength(0);
    expect((await getEvalView(pool, who("techA"), id))!.aiAssist).toBe(false);          // no key in this process
  });
  it("sends one bidder's response, returns checked findings, and audits without storing content", async () => {
    await saveConfig(pool, who("admin", "admin"), { ...DEFAULT_CONFIG, aiAssist: true });
    const id = (await makeEvent(admin, X, "technical_evaluation")).id;
    const view = (await getEvalView(pool, who("techA"), id))!;
    const b = view.bidders![0]!;
    const text = b.technicalText;
    expect(text.length).toBeGreaterThan(20);
    const calls: { body: string }[] = [];
    const quote = text.slice(0, 25);
    const r = await suggestFindings(pool, who("techA"), id, b.supplierId, { env, fetch: fakeAi({ findings: [{ criterion: view.criteria[0], assessment: "meets", summary: "ok", quotes: [quote, "this quote does not exist anywhere"] }] }, calls) });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.findings).toHaveLength(view.criteria.length);
    expect(r.findings[0]).toMatchObject({ assessment: "meets", quotes: [quote], droppedQuotes: 1 });
    expect(calls).toHaveLength(1);
    const sent = JSON.parse(calls[0]!.body).messages[0].content as string;
    const others = view.bidders!.filter((x) => x.supplierId !== b.supplierId);
    for (const o of others) expect(sent).not.toContain(o.technicalText);
    const a = (await admin.query(`select detail from audit_event where event_id = $1 and action = 'evaluation.ai_assist'`, [id])).rows;
    expect(a).toHaveLength(1);
    expect(JSON.stringify(a[0].detail)).not.toContain(quote);
    expect(await suggestFindings(pool, who("techA"), id, "00000000-0000-0000-0000-000000000000", { env, fetch: fakeAi({}, calls) })).toMatchObject({ ok: false });
  });
  it("does not run on a recused evaluator or before the envelopes are open", async () => {
    await saveConfig(pool, who("admin", "admin"), { ...DEFAULT_CONFIG, aiAssist: true, evaluatorDeclarations: true });
    const id = (await makeEvent(admin, X, "technical_evaluation")).id;
    const calls: { body: string }[] = [];
    expect(await suggestFindings(pool, who("techA"), id, X.suppliers[0].id, { env, fetch: fakeAi({ findings: [] }, calls) })).toMatchObject({ ok: false });
    const closed = (await makeEvent(admin, X, "closed")).id;
    expect(await suggestFindings(pool, who("techA"), closed, X.suppliers[0].id, { env, fetch: fakeAi({ findings: [] }, calls) })).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });
});
