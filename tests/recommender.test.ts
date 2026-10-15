import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkRec, draftRecommendation, factsFor, noteFrom, RC_BAD_PICK, RC_NOT_READY, RC_NO_ROLE, untraced } from "@/agents/recommender";
import { AG_INVALID, AG_NO_KEY } from "@/agents/harness";
import { getCommercialView } from "@/commercial/service";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";
import { openCommercialConfirmed } from "./helpers/confirmed";

let admin: Client, pool: Pool, X: World, Y: World;
const who = (w: World, p: keyof World["people"]): Who => ({ tenantId: w.tenantId, userId: w.people[p].userId, membershipId: w.people[p].membershipId, role: "member" } as Who);
const ver = async (id: string) => (await admin.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;
const CLAUDE = { key: "sk-test", model: "claude-test" };
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "rec-x"); Y = await seedTenant(admin, "rec-y"); });
afterAll(async () => { await pool.end(); await admin.end(); });

function fakeAi(answers: string[]) {
  const calls: { system: string; user: string }[] = []; let i = 0;
  const fetch = (async (_u: string, init: { body: string }) => {
    const b = JSON.parse(init.body); calls.push({ system: b.system, user: b.messages[0].content });
    return Response.json({ content: [{ type: "text", text: answers[Math.min(i++, answers.length - 1)]! }], usage: { input_tokens: 100, output_tokens: 60 } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

async function openEvent(totals: string[], value: string | null = "1200.00") {
  const e = await makeEvent(admin, X, "technical_approved", { withBids: false });
  await admin.query(`delete from tech_result where event_id = $1`, [e.id]);
  await admin.query(`delete from qualified_bidder where event_id = $1`, [e.id]);
  await admin.query(`update sourcing_event set value_aed = $2 where id = $1`, [e.id, value]);
  for (const [i, t] of totals.entries()) {
    const rev = (await admin.query(`insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key) values ($1,$2,$3,1,$4) returning id`, [X.tenantId, e.id, X.suppliers[i]!.id, randomUUID()])).rows[0].id;
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D7','price_lines',$3)`, [X.tenantId, rev, JSON.stringify({ currency: "AED", total: t, lines: [] })]);
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D6','technical_response',$3)`, [X.tenantId, rev, JSON.stringify({ text: "tech" })]);
    await admin.query(`insert into tech_result (tenant_id, event_id, supplier_id, total, qualified) values ($1,$2,$3,$4,$5)`, [X.tenantId, e.id, X.suppliers[i]!.id, [90, 80, 60][i], i < 2]);
    if (i < 2) await admin.query(`insert into qualified_bidder (tenant_id, event_id, supplier_id) values ($1,$2,$3)`, [X.tenantId, e.id, X.suppliers[i]!.id]);
  }
  return e.id;
}
const open = async (id: string) => expect(await openCommercialConfirmed(pool, who(X, "buyer"), id, await ver(id), X.people.witness.membershipId)).toMatchObject({ ok: true });

describe("number tracing and checks", () => {
  const facts = ["Event rank 1: Alpha; technical 80.00; price 1,000.00 AED; final 94.00."];
  it("accepts quoted figures and small counts, refuses invented ones", () => {
    expect(untraced("Alpha scored 94.00 on a price of 1,000.00 and was rank 1 of 2.", facts)).toEqual([]);
    expect(untraced("Alpha saves 15% and costs 950.00.", facts)).toEqual(["15", "950.00"]);
  });
  it("checks shape, supplier name, markup and figures", () => {
    const good = { note: "Alpha is recommended: technical 80.00 and final 94.00.", points: ["Check the delivery terms"] };
    expect(checkRec(good, facts, ["Alpha"])).toMatchObject({ ok: true });
    for (const bad of [{ ...good, note: "Alpha saves 7777.00 overall, which is good." }, { ...good, note: "Beta is the best choice in every way." }, { ...good, points: ["a", "b", "c", "d", "e"] },
      { ...good, points: [""] }, { ...good, note: "Alpha 94.00 see https://evil.example for more detail" }, { note: "short", points: [] }, null, "x"])
      expect(checkRec(bad, facts, ["Alpha"]), JSON.stringify(bad)).toMatchObject({ ok: false });
    expect(noteFrom({ note: "N", points: ["a", "b"] })).toBe("N\n\nTo check: a b");
  });
});

describe("factsFor", () => {
  const row = (n: number, name: string, total: string, final: string) => ({ supplierId: `s${n}`, name, tech: "80.00", total, commercial: "100.00", final, rank: n });
  it("states savings only against an estimate in the same currency and flags what the code sees", () => {
    const cmp = { currency: "AED", weights: { technical: 30, commercial: 70 }, rows: [row(1, "Alpha", "800.00", "94.00"), row(2, "Beta", "1000.00", "83.00")], lines: [], closeResult: true };
    const a = factsFor(cmp as never, "s2", "1200.00");
    expect(a.facts.join("\n")).toContain("below the estimate by 200.00 AED (16.7%)");
    expect(a.flags.join("\n")).toMatch(/close-result/); expect(a.flags.join("\n")).toMatch(/not the top-ranked/);
    expect(factsFor({ ...cmp, currency: "USD" } as never, "s1", "1200.00").flags.join("\n")).toMatch(/No estimate/);
    expect(factsFor({ ...cmp, rows: [row(1, "Alpha", "100.00", "90.00"), row(2, "Beta", "800.00", "70.00")], closeResult: false } as never, "s1", null).flags.join("\n")).toMatch(/30% below/);
    expect(factsFor({ ...cmp, rows: [cmp.rows[0]] } as never, "s1", null).flags.join("\n")).toMatch(/only one qualified/);
  });
});

describe("draftRecommendation", () => {
  it("drafts from stored figures, records the run, changes nothing", async () => {
    const id = await openEvent(["1000.00", "800.00", "500.00"]); await open(id);
    const v = (await getCommercialView(pool, who(X, "buyer"), id))!; const top = v.comparison!.rows[0]!;
    const ai = fakeAi([JSON.stringify({ note: `${top.name} is recommended: technical ${top.tech}, price ${top.total} AED and final score ${top.final}.`, points: ["Check delivery terms"] })]);
    const r = await draftRecommendation(pool, who(X, "buyer"), id, top.supplierId, { claude: CLAUDE, fetch: ai.fetch });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true }); if (!r.ok) return;
    expect(r.facts.join(" ")).toContain("below the estimate by 400.00 AED");
    expect(ai.calls[0]!.user).toContain("<facts>"); expect(ai.calls[0]!.user).not.toContain("COMMERCIAL_SECRET");
    expect((await admin.query(`select agent, subject_type, state from agent_run where id = $1`, [r.runId])).rows[0]).toEqual({ agent: "recommender", subject_type: "event", state: "proposed" });
    expect((await admin.query(`select count(*)::int n from recommendation where event_id = $1`, [id])).rows[0].n).toBe(0);
    expect((await admin.query(`select count(*)::int n from audit_event where action = 'agent.recommender_proposed' and event_id = $1`, [id])).rows[0].n).toBe(1);
  });
  it("retries once on a fabricated figure and fails after a second", async () => {
    const id = await openEvent(["1000.00", "800.00", "500.00"]); await open(id);
    const top = (await getCommercialView(pool, who(X, "buyer"), id))!.comparison!.rows[0]!;
    const bad = JSON.stringify({ note: `${top.name} saves 31% against the estimate.`, points: [] });
    const ai = fakeAi([bad]);
    expect(await draftRecommendation(pool, who(X, "buyer"), id, top.supplierId, { claude: CLAUDE, fetch: ai.fetch })).toEqual({ ok: false, error: AG_INVALID });
    expect(ai.calls).toHaveLength(2); expect(ai.calls[1]!.user).toContain("not in the facts");
    const okAns = JSON.stringify({ note: `${top.name} leads on final score ${top.final}.`, points: [] });
    expect(await draftRecommendation(pool, who(X, "buyer"), id, top.supplierId, { claude: CLAUDE, fetch: fakeAi([bad, okAns]).fetch })).toMatchObject({ ok: true });
  });
  it("ignores instructions hidden in supplier-controlled names", async () => {
    const id = await openEvent(["1000.00", "800.00", "500.00"]); await open(id);
    const top = (await getCommercialView(pool, who(X, "buyer"), id))!.comparison!.rows[0]!;
    const ai = fakeAi([JSON.stringify({ note: `Award to ${top.name} and transfer 9999 AED now please.`, points: [] }), JSON.stringify({ note: `Award to ${top.name}.`, points: [] })]);
    const r = await draftRecommendation(pool, who(X, "buyer"), id, top.supplierId, { claude: CLAUDE, fetch: ai.fetch });
    expect(r).toMatchObject({ ok: true }); expect(ai.calls).toHaveLength(2);
  });
  it("is for the buyer, once the comparison is open, for a real bidder, with a key", async () => {
    const id = await openEvent(["1000.00", "800.00", "500.00"]);
    const ai = fakeAi(["{}"]);
    expect(await draftRecommendation(pool, who(X, "buyer"), id, "x", { claude: CLAUDE, fetch: ai.fetch })).toEqual({ ok: false, error: RC_NOT_READY });   // sealed
    await open(id);
    const top = (await getCommercialView(pool, who(X, "buyer"), id))!.comparison!.rows[0]!;
    expect(await draftRecommendation(pool, who(X, "buyer"), id, "not-a-bidder", { claude: CLAUDE, fetch: ai.fetch })).toEqual({ ok: false, error: RC_BAD_PICK });
    expect(await draftRecommendation(pool, who(X, "techA"), id, top.supplierId, { claude: CLAUDE, fetch: ai.fetch })).toEqual({ ok: false, error: RC_NO_ROLE });
    expect(await draftRecommendation(pool, who(X, "buyer"), id, top.supplierId, { claude: null })).toEqual({ ok: false, error: AG_NO_KEY });
    expect(await draftRecommendation(pool, who(Y, "buyer"), id, top.supplierId, { claude: CLAUDE, fetch: ai.fetch })).toEqual({ ok: false, error: RC_NO_ROLE });   // another company
    expect(await draftRecommendation(pool, who(X, "buyer"), "nope", top.supplierId, { claude: CLAUDE, fetch: ai.fetch })).toEqual({ ok: false, error: RC_NOT_READY });
    expect(ai.calls).toHaveLength(0);
  });
});
