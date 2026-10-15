import type { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chat, assistantAvailable, type StreamEvent } from "@/assistant/service";
import { needsCompany, resetFreeCooldown } from "@/assistant/free";
import { DEFAULT_SETTINGS, freeFor } from "@/assistant/models";
const freeConfig = (env: NodeJS.ProcessEnv) => freeFor(DEFAULT_SETTINGS, env);
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, A: World, n = 0; let adminClientRef: Client;
const nextWho = (): Who & { tenantName: string } => { const keys = ["buyer", "admin", "auditor", "requester", "witness", "comm", "techA", "techB", "delegate", "integ"] as const; const p = A.people[keys[n++ % keys.length]!]; return { tenantId: A.tenantId, userId: p.userId, membershipId: p.membershipId, role: "member", perms: ["event.read_all", "event.create"], tenantName: "Secret Holdings Ltd" }; };
const both = { ANTHROPIC_API_KEY: "claude-key", GROQ_API_KEY: "free-key", ASSISTANT_DAILY_LIMIT: "1000" } as unknown as NodeJS.ProcessEnv;
const freeOnly = { GROQ_API_KEY: "free-key", ASSISTANT_DAILY_LIMIT: "1000" } as unknown as NodeJS.ProcessEnv;
const json = (b: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } }));
const freeReply = (t: string) => json({ choices: [{ message: { content: t } }] });
const claudeReply = (t: string) => json({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });
const sse = (lines: string[]) => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (const l of lines) c.enqueue(e.encode(`data: ${l}\n\n`)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
const chunk = (t: string) => JSON.stringify({ choices: [{ delta: { content: t } }] });

type Call = { url: string; body: string };
function router(handlers: { free?: (c: Call) => Promise<Response>; claude?: (c: Call) => Promise<Response> }) {
  const calls: Call[] = [];
  const fake = ((url: string, init: RequestInit) => { const c = { url, body: String(init.body) }; calls.push(c); return url.includes("anthropic") ? (handlers.claude ?? (() => claudeReply("from claude")))(c) : (handlers.free ?? (() => freeReply("from free")))(c); }) as unknown as typeof fetch;
  return { calls, fake, free: () => calls.filter((c) => !c.url.includes("anthropic")), claude: () => calls.filter((c) => c.url.includes("anthropic")) };
}
const ask = (q: string, deps: Parameters<typeof chat>[3], path = "/", emit?: (e: StreamEvent) => void) => chat(pool, nextWho(), { messages: [{ role: "user", content: q }], path }, deps, emit);

beforeAll(async () => { admin = await adminClient(); adminClientRef = admin; pool = makePool(); A = await seedTenant(admin, "free-a"); await makeEvent(admin, A, "draft"); await admin.query(`update sourcing_event set ref = 'EV-FREE-1', title = 'Confidential acquisition of Plant X' where tenant_id = $1`, [A.tenantId]); });
beforeEach(() => resetFreeCooldown());
afterAll(async () => { await pool.end(); await admin.end(); });

describe("configuration", () => {
  it("is off without a key, and works with either provider", () => {
    expect(freeConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(freeConfig({ GROQ_API_KEY: "k", ASSISTANT_FREE: "off" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(freeConfig(freeOnly)).toMatchObject({ baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" });
    expect(freeConfig({ FREE_LLM_API_KEY: "k", FREE_LLM_BASE_URL: "https://x.test/v1/", FREE_LLM_MODEL: "m" } as unknown as NodeJS.ProcessEnv)).toEqual({ key: "k", baseUrl: "https://x.test/v1", model: "m" });
    expect(assistantAvailable({} as NodeJS.ProcessEnv)).toBe(false);
    expect(assistantAvailable(freeOnly)).toBe(true);
  });
});

describe("what may go to a free model", () => {
  it("keeps questions about the person's own data or about changes away from it", () => {
    for (const q of ["Which events close this week?", "What is the status of EV-2026-014?", "show my draft events", "Create an event called Cable trays", "add an item to this event", "rename the event", "why can't I submit?", "how many suppliers have bid on our RFQ?"]) expect(needsCompany(q, "/"), q).toBe(true);
    expect(needsCompany("anything", "/events/7f1c2b0a-1111-4222-8333-444455556666")).toBe(true);
  });
  it("lets general how-to questions through", () => {
    for (const q of ["How do lots work?", "What is the difference between RFQ and RFP?", "How do I enable a template?", "How does commercial scoring work?", "How do I import lanes from Excel?"]) expect(needsCompany(q, "/templates"), q).toBe(false);
  });
});

describe("free first, Claude as the fallback", () => {
  it("answers a how-to question on the free model alone, and logs it as free", async () => {
    const r = router({});
    const out = await ask("How do lots work?", { env: both, fetch: r.fake });
    expect(out).toMatchObject({ ok: true, reply: "from free" });
    expect(r.claude()).toHaveLength(0); expect(r.free()).toHaveLength(1);
    await new Promise((x) => setTimeout(x, 300));
    expect((await admin.query(`select provider from assistant_message where tenant_id = $1 and question = 'How do lots work?'`, [A.tenantId])).rows[0].provider).toBe("free");
  });
  it("sends the free model nothing about the company: no name, role, event, tools or earlier chat", async () => {
    const r = router({});
    await chat(pool, nextWho(), { messages: [{ role: "user", content: "Which event is EV-FREE-1?" }, { role: "assistant", content: "Confidential acquisition of Plant X" }, { role: "user", content: "How do lots work?" }], path: "/events/7f1c2b0a-1111-4222-8333-444455556666" }, { env: both, fetch: r.fake });
    expect(r.free()).toHaveLength(0);   // an event page: stays on Claude
    const r2 = router({});
    await chat(pool, nextWho(), { messages: [{ role: "user", content: "Which event is EV-FREE-1?" }, { role: "assistant", content: "Confidential acquisition of Plant X" }, { role: "user", content: "How do suppliers bid?" }], path: "/" }, { env: both, fetch: r2.fake });
    expect(r2.free()).toHaveLength(1);
    const sent = r2.free()[0]!.body;
    for (const secret of ["Secret Holdings", "EV-FREE-1", "Confidential acquisition", "tools", "list_events", "propose_action", "member"]) expect(sent, secret).not.toContain(secret);
    expect(JSON.parse(sent).messages).toHaveLength(2);
    expect(r2.free()[0]!.url).toContain("/chat/completions");
  });
  it("sends questions about the company's own data straight to Claude", async () => {
    const r = router({});
    const out = await ask("Which events close this week?", { env: both, fetch: r.fake });
    expect(out).toMatchObject({ ok: true, reply: "from claude" });
    expect(r.free()).toHaveLength(0);
  });
  it("hands up to Claude when the free model says ESCALATE, an empty answer, an error, or a rate limit", async () => {
    for (const free of [() => freeReply("ESCALATE"), () => freeReply("  escalate. "), () => freeReply(""), () => json({}, 500), () => json({}, 429)]) {
      resetFreeCooldown();
      const r = router({ free });
      const out = await ask("How do suppliers bid?", { env: both, fetch: r.fake });
      expect(out, String(free)).toMatchObject({ ok: true, reply: "from claude" });
      expect(r.claude()).toHaveLength(1);
    }
  });
  it("records why the free model did not answer", async () => {
    const why = async (free: () => Promise<Response>, q = "How do suppliers bid?", env = both) => {
      resetFreeCooldown(); const r = router({ free }); await ask(q, { env, fetch: r.fake });
      await new Promise((x) => setTimeout(x, 250));
      return (await admin.query(`select provider from assistant_message where tenant_id = $1 and question = $2 order by created_at desc limit 1`, [A.tenantId, q])).rows[0].provider as string;
    };
    expect(await why(() => json({}, 401), "How do suppliers bid? a")).toBe("claude:free-http-401");
    expect(await why(() => freeReply("ESCALATE"), "How do suppliers bid? b")).toBe("claude:free-escalate");
    expect(await why(() => freeReply("x"), "How do suppliers bid? c")).toBe("claude:free-empty");
    expect(await why(() => json({}, 200), "Which events close this week?")).toBe("claude:data");
    expect(await why(() => json({}, 200), "How do suppliers bid? d", { ANTHROPIC_API_KEY: "k", ASSISTANT_DAILY_LIMIT: "1000" } as unknown as NodeJS.ProcessEnv)).toBe("claude:no-free-key");
  });
  it("skips the free model for a minute after it was rate limited", async () => {
    const r = router({ free: () => json({}, 429) });
    await ask("How do suppliers bid?", { env: both, fetch: r.fake });
    await ask("How do lots work?", { env: both, fetch: r.fake });
    expect(r.free()).toHaveLength(1); expect(r.claude()).toHaveLength(2);
  });
  it("with only a free key, answers how-to questions and says so politely for the rest", async () => {
    const r = router({});
    expect(await ask("How do lots work?", { env: freeOnly, fetch: r.fake })).toMatchObject({ ok: true, reply: "from free" });
    expect(await ask("Which events close this week?", { env: freeOnly, fetch: r.fake })).toMatchObject({ ok: false });
    expect(await ask("How do suppliers bid?", { env: freeOnly, fetch: router({ free: () => json({}, 500) }).fake })).toMatchObject({ ok: false });
  });
  it("without a free key nothing changes", async () => {
    const r = router({});
    expect(await ask("How do lots work?", { env: { ANTHROPIC_API_KEY: "k", ASSISTANT_DAILY_LIMIT: "1000" } as unknown as NodeJS.ProcessEnv, fetch: r.fake })).toMatchObject({ reply: "from claude" });
    expect(r.free()).toHaveLength(0);
  });
});

describe("streaming from the free model", () => {
  it("streams the answer piece by piece", async () => {
    const r = router({ free: () => Promise.resolve(sse([chunk("Open the "), chunk("Templates page, "), chunk("tick it and save."), "[DONE]"])) });
    const ev: StreamEvent[] = [];
    const out = await ask("How do I enable a template?", { env: both, fetch: r.fake }, "/templates", (e) => ev.push(e));
    expect(JSON.parse(r.free()[0]!.body).stream).toBe(true);
    expect(ev.filter((e) => e.t === "delta").map((e) => (e as { x: string }).x).join("")).toBe("Open the Templates page, tick it and save.");
    expect(out).toMatchObject({ ok: true, reply: "Open the Templates page, tick it and save." });
  });
  it("never shows a handed-up question's text, and starts Claude's answer clean", async () => {
    const r = router({ free: () => Promise.resolve(sse([chunk("ESC"), chunk("ALATE"), "[DONE]"])), claude: () => claudeReply("from claude") });
    const ev: StreamEvent[] = [];
    const out = await ask("How do suppliers bid?", { env: both, fetch: r.fake }, "/", (e) => ev.push(e));
    expect(out).toMatchObject({ ok: true, reply: "from claude" });
    const shown = ev.filter((e) => e.t === "delta").map((e) => (e as { x: string }).x).join("");
    expect(shown).toBe("from claude");
  });
});

import { getSettings, saveSettings, testModel, providerStatus, claudeModelFor, cleanModel, M_NO_PERM } from "@/assistant/models";
describe("model settings (Configuration screen)", () => {
  const adm = (w: World): Who => ({ tenantId: w.tenantId, userId: w.people.admin.userId, membershipId: w.people.admin.membershipId, role: "admin", perms: ["config.manage"] });
  const plain = (w: World): Who => ({ tenantId: w.tenantId, userId: w.people.buyer.userId, membershipId: w.people.buyer.membershipId, role: "member", perms: ["event.create"] });
  let B: World;
  beforeAll(async () => { B = await seedTenant(adminClientRef, "free-b"); });
  it("defaults to free first, and only an administrator can change it", async () => {
    expect(await getSettings(pool, A.tenantId)).toEqual(DEFAULT_SETTINGS);
    expect(await saveSettings(pool, plain(A), { mode: "claude_only", freeProvider: "auto", freeModel: "", claudeModel: "" })).toEqual({ ok: false, error: M_NO_PERM });
  });
  it("validates choices and model names", async () => {
    expect(cleanModel("llama-3.3-70b-versatile")).toBe("llama-3.3-70b-versatile");
    expect(cleanModel("meta-llama/llama-3.3-70b-instruct:free")).toBe("meta-llama/llama-3.3-70b-instruct:free");
    expect(cleanModel("")).toBe(""); expect(cleanModel("bad name")).toBeNull(); expect(cleanModel("x;drop")).toBeNull(); expect(cleanModel("a".repeat(101))).toBeNull();
    expect(await saveSettings(pool, adm(A), { mode: "everything", freeProvider: "auto", freeModel: "", claudeModel: "" })).toMatchObject({ ok: false });
    expect(await saveSettings(pool, adm(A), { mode: "free_first", freeProvider: "https://evil.test", freeModel: "", claudeModel: "" })).toMatchObject({ ok: false });
    expect(await saveSettings(pool, adm(A), { mode: "free_first", freeProvider: "groq", freeModel: "bad name", claudeModel: "" })).toMatchObject({ ok: false });
  });
  it("saves per company, audits it, and the choice changes what the assistant does", async () => {
    expect(await saveSettings(pool, adm(A), { mode: "free_first", freeProvider: "openrouter", freeModel: "my/model:free", claudeModel: "claude-test-1" })).toMatchObject({ ok: true });
    expect(await getSettings(pool, A.tenantId)).toMatchObject({ freeProvider: "openrouter", freeModel: "my/model:free", claudeModel: "claude-test-1" });
    expect(await getSettings(pool, B.tenantId)).toEqual(DEFAULT_SETTINGS);
    expect((await admin.query(`select count(*)::int n from audit_event where tenant_id = $1 and action = 'assistant.settings'`, [A.tenantId])).rows[0].n).toBe(1);
    const envs = { ANTHROPIC_API_KEY: "c", GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o", ASSISTANT_DAILY_LIMIT: "1000" } as unknown as NodeJS.ProcessEnv;
    const r = router({});
    await ask("How do lots work?", { env: envs, fetch: r.fake });
    expect(r.free()[0]!.url).toContain("openrouter.ai");
    expect(JSON.parse(r.free()[0]!.body).model).toBe("my/model:free");
    expect(r.free()[0]!.body).not.toContain("g\"");
    const r2 = router({});
    await ask("Which events close this week?", { env: envs, fetch: r2.fake });
    expect(JSON.parse(r2.claude()[0]!.body).model).toBe("claude-test-1");
  });
  it("Claude only never calls a free model, and a provider without a key is skipped", async () => {
    await saveSettings(pool, adm(A), { mode: "claude_only", freeProvider: "auto", freeModel: "", claudeModel: "" });
    const r = router({});
    await ask("How do lots work?", { env: both, fetch: r.fake });
    expect(r.free()).toHaveLength(0); expect(r.claude()).toHaveLength(1);
    await saveSettings(pool, adm(A), { mode: "free_first", freeProvider: "gemini", freeModel: "", claudeModel: "" });
    const r2 = router({});
    await ask("How do suppliers bid?", { env: both, fetch: r2.fake });   // only a Groq key is set, Gemini was chosen: no free call
    expect(r2.free()).toHaveLength(0);
    await saveSettings(pool, adm(A), DEFAULT_SETTINGS);
  });
  it("shows which keys are set (never their values) and tests the chosen model", async () => {
    const st = providerStatus(both);
    expect(st.find((p) => p.id === "groq")!.keySet).toBe(true); expect(st.find((p) => p.id === "gemini")!.keySet).toBe(false);
    expect(JSON.stringify(st)).not.toContain("free-key");
    expect(claudeModelFor(DEFAULT_SETTINGS, {} as NodeJS.ProcessEnv)).toBe("claude-sonnet-4-5");
    expect(await testModel(pool, plain(A), "free", { env: both })).toMatchObject({ ok: false });
    expect(await testModel(pool, adm(A), "free", { env: both, fetch: router({}).fake })).toMatchObject({ ok: true });
    expect(await testModel(pool, adm(A), "free", { env: both, fetch: router({ free: () => json({}, 401) }).fake })).toMatchObject({ ok: false, message: expect.stringMatching(/rejected the key/) });
    expect(await testModel(pool, adm(A), "free", { env: both, fetch: router({ free: () => json({}, 404) }).fake })).toMatchObject({ ok: false, message: expect.stringMatching(/model name/) });
    expect(await testModel(pool, adm(A), "free", { env: {} as NodeJS.ProcessEnv })).toMatchObject({ ok: false, message: expect.stringMatching(/No key/) });
    expect(await testModel(pool, adm(A), "claude", { env: both, fetch: router({}).fake })).toMatchObject({ ok: true });
  });
});
