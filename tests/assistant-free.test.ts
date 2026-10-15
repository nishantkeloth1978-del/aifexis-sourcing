import type { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chat, type StreamEvent } from "@/assistant/service";
import { needsCompany, resetFreeCooldown } from "@/assistant/free";
import { DEFAULT_SETTINGS, loadRuntime, assistantEnabled } from "@/assistant/models";
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

type Call = { url: string; body: string; auth: string; xkey: string };
function router(handlers: { free?: (c: Call) => Promise<Response>; claude?: (c: Call) => Promise<Response> }) {
  const calls: Call[] = [];
  const fake = ((url: string, init: RequestInit) => { const h = (init.headers ?? {}) as Record<string, string>; const c = { url, body: String(init.body), auth: h.authorization ?? "", xkey: h["x-api-key"] ?? "" }; calls.push(c); return url.includes("anthropic") ? (handlers.claude ?? (() => claudeReply("from claude")))(c) : (handlers.free ?? (() => freeReply("from free")))(c); }) as unknown as typeof fetch;
  return { calls, fake, free: () => calls.filter((c) => !c.url.includes("anthropic")), claude: () => calls.filter((c) => c.url.includes("anthropic")) };
}
const ask2 = (w: World, q: string, deps: Parameters<typeof chat>[3], who: "buyer" | "witness" | "comm" | "techA" | "techB" = "buyer", path = "/") => { const p = w.people[who]; return chat(pool, { tenantId: w.tenantId, userId: p.userId, membershipId: p.membershipId, role: "member", perms: ["event.read_all", "event.create"], tenantName: "K Co" }, { messages: [{ role: "user", content: q }], path }, deps); };
const ask = (q: string, deps: Parameters<typeof chat>[3], path = "/", emit?: (e: StreamEvent) => void) => chat(pool, nextWho(), { messages: [{ role: "user", content: q }], path }, deps, emit);

beforeAll(async () => { admin = await adminClient(); adminClientRef = admin; pool = makePool(); A = await seedTenant(admin, "free-a"); await makeEvent(admin, A, "draft"); await admin.query(`update sourcing_event set ref = 'EV-FREE-1', title = 'Confidential acquisition of Plant X' where tenant_id = $1`, [A.tenantId]); });
beforeEach(() => resetFreeCooldown());
afterAll(async () => { await pool.end(); await admin.end(); });

describe("what is available without any server setting", () => {
  it("is off until the company adds a key in the app", async () => {
    expect(await loadRuntime(pool, A.tenantId, {} as NodeJS.ProcessEnv)).toMatchObject({ free: [], claude: null });
    expect(await assistantEnabled(pool, A.tenantId, {} as NodeJS.ProcessEnv)).toBe(false);
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
    expect((await admin.query(`select provider from assistant_message where tenant_id = $1 and question = 'How do lots work?'`, [A.tenantId])).rows[0].provider).toBe("free:groq");
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

import { getSettings, saveSettings, setKey, removeKey, screenFor, testProvider, cleanModel, M_NO_PERM, M_BAD_KEY, M_NO_MASTER, T_KEY, T_NONE } from "@/assistant/models";
import { decryptKey, encryptKey, encryptionReady } from "@/assistant/keys";

const MASTER = "m".repeat(40);
const withMaster = (e: Partial<Record<string, string>> = {}) => ({ ASSISTANT_DAILY_LIMIT: "1000", SIGNING_SECRET: MASTER, ...e }) as unknown as NodeJS.ProcessEnv;

describe("key encryption", () => {
  it("round-trips, and is useless for another company, another provider, another master key or a damaged value", () => {
    const env = withMaster();
    const blob = encryptKey("gsk_secret_value_1234", "tenant-1", "groq", env);
    expect(blob).not.toContain("gsk_secret_value_1234");
    expect(decryptKey(blob, "tenant-1", "groq", env)).toBe("gsk_secret_value_1234");
    expect(decryptKey(blob, "tenant-2", "groq", env)).toBeNull();
    expect(decryptKey(blob, "tenant-1", "gemini", env)).toBeNull();
    expect(decryptKey(blob, "tenant-1", "groq", withMaster({ SIGNING_SECRET: "z".repeat(40) }))).toBeNull();
    expect(decryptKey(blob.slice(0, -4) + "AAAA", "tenant-1", "groq", env)).toBeNull();
    expect(decryptKey("garbage", "tenant-1", "groq", env)).toBeNull();
    expect(encryptKey("same", "t", "groq", env)).not.toBe(encryptKey("same", "t", "groq", env));
  });
  it("needs a long enough master key", () => {
    expect(encryptionReady({} as NodeJS.ProcessEnv)).toBe(false);
    expect(encryptionReady({ SIGNING_SECRET: "short" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(() => encryptKey("k", "t", "groq", {} as NodeJS.ProcessEnv)).toThrow();
  });
});

describe("model settings and keys (Configuration screen)", () => {
  let K: World, O: World;
  const adm = (w: World): Who & { email: string } => ({ tenantId: w.tenantId, userId: w.people.admin.userId, membershipId: w.people.admin.membershipId, role: "admin", perms: ["config.manage"], email: "admin@test.co" });
  const plain = (w: World): Who => ({ tenantId: w.tenantId, userId: w.people.buyer.userId, membershipId: w.people.buyer.membershipId, role: "member", perms: ["event.create"] });
  const asker = (w: World, who: "buyer" | "witness" | "comm" | "techA" | "techB" = "buyer"): Who & { tenantName: string } => { const p = w.people[who]; return { tenantId: w.tenantId, userId: p.userId, membershipId: p.membershipId, role: "member", perms: ["event.read_all", "event.create"], tenantName: "K Co" }; };
  const save = (w: World, patch: object = {}) => saveSettings(pool, adm(w), { mode: "free_first", order: [], models: {}, ...patch });
  beforeAll(async () => { K = await seedTenant(adminClientRef, "free-k"); O = await seedTenant(adminClientRef, "free-o"); });

  it("defaults to free first, and only an administrator can change settings or keys", async () => {
    expect(await getSettings(pool, K.tenantId)).toEqual(DEFAULT_SETTINGS);
    expect(await saveSettings(pool, plain(K), { mode: "claude_only", order: [], models: {} })).toEqual({ ok: false, error: M_NO_PERM });
    expect(await setKey(pool, plain(K), "groq", "gsk_abcdefgh1234", withMaster())).toEqual({ ok: false, error: M_NO_PERM });
    expect(await removeKey(pool, plain(K), "groq")).toEqual({ ok: false, error: M_NO_PERM });
    expect(await testProvider(pool, plain(K), "groq", { env: withMaster() })).toMatchObject({ ok: false, message: M_NO_PERM });
  });
  it("validates choices, order and model names", async () => {
    expect(cleanModel("openai/gpt-oss-120b:free")).toBe("openai/gpt-oss-120b:free");
    expect(cleanModel("")).toBe(""); expect(cleanModel("bad name")).toBeNull(); expect(cleanModel("x;drop")).toBeNull(); expect(cleanModel("a".repeat(101))).toBeNull();
    for (const bad of [{ mode: "everything" }, { order: ["groq", "groq"] }, { order: ["https://evil.test"] }, { order: ["claude"] }, { models: { groq: "bad name" } }, { models: { evil: "x" } }]) expect(await save(K, bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    expect(await getSettings(pool, K.tenantId)).toEqual(DEFAULT_SETTINGS);
  });
  it("stores a key encrypted, shows only its last four characters, and keeps it per company", async () => {
    expect(await setKey(pool, adm(K), "groq", "short", withMaster())).toEqual({ ok: false, error: M_BAD_KEY });
    expect(await setKey(pool, adm(K), "groq", "has space inside key", withMaster())).toEqual({ ok: false, error: M_BAD_KEY });
    expect(await setKey(pool, adm(K), "groq", "gsk_abcdefgh1234", {} as NodeJS.ProcessEnv)).toEqual({ ok: false, error: M_NO_MASTER });
    expect(await setKey(pool, adm(K), "nonsense", "gsk_abcdefgh1234", withMaster())).toMatchObject({ ok: false });
    expect(await setKey(pool, adm(K), "groq", "gsk_abcdefgh1234", withMaster())).toEqual({ ok: true, last4: "1234" });
    const row = (await admin.query(`select ciphertext, last4, added_by from assistant_key where tenant_id = $1 and provider = 'groq'`, [K.tenantId])).rows[0];
    expect(row.ciphertext).not.toContain("gsk_abcdefgh"); expect(row.last4).toBe("1234"); expect(row.added_by).toBe("admin@test.co");
    expect(decryptKey(row.ciphertext, K.tenantId, "groq", withMaster())).toBe("gsk_abcdefgh1234");
    const screen = await screenFor(pool, K.tenantId, withMaster());
    expect(JSON.stringify(screen)).not.toContain("gsk_abcdefgh"); expect(screen.encryption).toBe(true);
    expect(screen.cards.find((c) => c.id === "groq")).toMatchObject({ hasKey: true, last4: "1234" });
    expect(screen.cards.find((c) => c.id === "gemini")).toMatchObject({ hasKey: false, last4: "" });
    expect((await screenFor(pool, O.tenantId, withMaster())).cards.find((c) => c.id === "groq")!.hasKey).toBe(false);
    expect((await admin.query(`select count(*)::int n from audit_event where tenant_id = $1 and action = 'assistant.key.set'`, [K.tenantId])).rows[0].n).toBe(1);
    expect(JSON.stringify((await admin.query(`select detail from audit_event where tenant_id = $1`, [K.tenantId])).rows)).not.toContain("gsk_");
  });
  it("the assistant works from a company's own key with no server key at all, and uses its model name", async () => {
    const none = withMaster();
    expect(await assistantEnabled(pool, K.tenantId, none)).toBe(true);
    await save(K, { models: { groq: "my-llama" } });
    const r = router({});
    expect(await ask2(K, "How do lots work?", { env: none, fetch: r.fake })).toMatchObject({ ok: true, reply: "from free" });
    expect(r.free()[0]!.auth).toBe("Bearer gsk_abcdefgh1234");
    expect(JSON.parse(r.free()[0]!.body).model).toBe("my-llama");
    expect(await assistantEnabled(pool, O.tenantId, none)).toBe(false);
  });
  it("tries providers in the company's order, moves on after a failure, and stops at a hand-up", async () => {
    await setKey(pool, adm(K), "openrouter", "sk-or-abcdef999", withMaster());
    await save(K, { order: ["openrouter", "groq"] });
    const r = router({ free: (c) => (c.url.includes("openrouter") ? json({}, 500) : freeReply("from groq")) });
    expect(await ask2(K, "How do suppliers bid?", { env: withMaster(), fetch: r.fake }, "witness")).toMatchObject({ ok: true, reply: "from groq" });
    expect(r.free().map((c) => (c.url.includes("openrouter") ? "openrouter" : "groq"))).toEqual(["openrouter", "groq"]);
    await new Promise((x) => setTimeout(x, 250));
    expect((await admin.query(`select provider from assistant_message where tenant_id = $1 and question = 'How do suppliers bid?' order by created_at desc limit 1`, [K.tenantId])).rows[0].provider).toBe("free:groq");
    resetFreeCooldown();
    const r2 = router({ free: (c) => (c.url.includes("openrouter") ? freeReply("ESCALATE") : freeReply("from groq")) });
    expect(await ask2(K, "How do suppliers bid?", { env: withMaster({ ANTHROPIC_API_KEY: "sk-ant-server" }), fetch: r2.fake }, "comm")).toMatchObject({ ok: true, reply: "from claude" });
    expect(r2.free()).toHaveLength(1);   // the second provider was not asked after a hand-up
  });
  it("uses the company's Claude key and model, never a server key", async () => {
    await setKey(pool, adm(K), "claude", "sk-ant-company-key-77", withMaster());
    await save(K, { models: { claude: "claude-company-model" } });
    const env = withMaster({ ANTHROPIC_API_KEY: "sk-ant-server-key" });
    const r = router({});
    await ask2(K, "Which events close this week?", { env, fetch: r.fake }, "techA");
    expect(r.claude()[0]!.xkey).toBe("sk-ant-company-key-77"); expect(JSON.parse(r.claude()[0]!.body).model).toBe("claude-company-model");
  });
  it("Claude only never calls a free model", async () => {
    await save(K, { mode: "claude_only" });
    const env = withMaster({ ANTHROPIC_API_KEY: "sk-ant-server-key" });
    const r = router({});
    await ask2(K, "How do lots work?", { env, fetch: r.fake }, "buyer");
    expect(r.free()).toHaveLength(0); expect(r.claude()).toHaveLength(1);
    await save(K);
  });
  it("tests the key and model in force, and says what is wrong", async () => {
    expect(await testProvider(pool, adm(K), "groq", { env: withMaster(), fetch: router({}).fake })).toMatchObject({ ok: true });
    expect(await testProvider(pool, adm(K), "groq", { env: withMaster(), fetch: router({ free: () => json({}, 401) }).fake })).toMatchObject({ ok: false, message: T_KEY });
    expect(await testProvider(pool, adm(K), "gemini", { env: withMaster(), fetch: router({}).fake })).toMatchObject({ ok: false, message: T_NONE });
    expect(await testProvider(pool, adm(K), "claude", { env: withMaster(), fetch: router({}).fake })).toMatchObject({ ok: true });
    expect(await testProvider(pool, adm(O), "claude", { env: withMaster(), fetch: router({}).fake })).toMatchObject({ ok: false, message: T_NONE });
  });
  it("removing a key stops its use (falling back to the server key if there is one), and the month's usage is counted", async () => {
    expect(await removeKey(pool, adm(K), "openrouter")).toEqual({ ok: true });
    expect(await removeKey(pool, adm(K), "groq")).toEqual({ ok: true });
    expect((await admin.query(`select count(*)::int n from assistant_key where tenant_id = $1 and provider in ('groq','openrouter')`, [K.tenantId])).rows[0].n).toBe(0);
    expect((await loadRuntime(pool, K.tenantId, withMaster())).free).toEqual([]);
    expect((await loadRuntime(pool, K.tenantId, withMaster({ GROQ_API_KEY: "server-groq" }))).free.map((c) => [c.id, c.key])).toEqual([["groq", "server-groq"]]);
    const u = (await screenFor(pool, K.tenantId, withMaster())).usage;
    expect(u.free).toBeGreaterThanOrEqual(2); expect(u.handedUp).toBeGreaterThanOrEqual(0); expect(u.claude).toBeGreaterThanOrEqual(1);
  });
  it("keeps a daily limit in the settings, within 1 to 5000", async () => {
    for (const bad of [0, 5001, 1.5, "10"]) expect(await save(K, { dailyLimit: bad }), String(bad)).toMatchObject({ ok: false });
    expect(await save(K, { dailyLimit: 250 })).toMatchObject({ ok: true });
    expect((await getSettings(pool, K.tenantId)).dailyLimit).toBe(250);
    await save(K);
  });
  it("derives key encryption from the signing secret alone", () => {
    const env = { SIGNING_SECRET: "s".repeat(40) } as unknown as NodeJS.ProcessEnv;
    expect(encryptionReady(env)).toBe(true); expect(encryptionReady({} as NodeJS.ProcessEnv)).toBe(false);
    expect(decryptKey(encryptKey("gsk_x1234567", "t", "groq", env), "t", "groq", env)).toBe("gsk_x1234567");
  });
});
