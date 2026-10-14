import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GUIDES, pickGuides } from "@/assistant/kb";
import { chat, cleanMessages, pageContext, systemPrompt } from "@/assistant/service";
import { runTool } from "@/assistant/tools";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, A: World, B: World;
const who = (w: World): Who & { tenantName: string } => ({ tenantId: w.tenantId, userId: w.people.buyer.userId, membershipId: w.people.buyer.membershipId, role: "member", perms: ["event.read_all", "event.create"], tenantName: "Test Co" });
const env = { ANTHROPIC_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv;

beforeAll(async () => { admin = await adminClient(); pool = makePool(); A = await seedTenant(admin, "asst-a"); B = await seedTenant(admin, "asst-b"); await makeEvent(admin, A, "published"); await makeEvent(admin, A, "draft"); await makeEvent(admin, B, "published");
  for (const [w, p] of [[A, "A"], [B, "B"]] as const) { let i = 0; for (const r of (await admin.query(`select id from sourcing_event where tenant_id = $1 order by created_at`, [w.tenantId])).rows) await admin.query(`update sourcing_event set ref = $2 where id = $1`, [r.id, `EV-T${p}-${++i}`]); } });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("guides", () => {
  it("picks the guides that match the question and the page", () => {
    expect(pickGuides("how do carriers price freight lanes?").map((g) => g.id)).toContain("freight");
    expect(pickGuides("why can't I submit").map((g) => g.id)).toContain("troubleshoot");
    expect(pickGuides("what about lots?", "/events/new").map((g) => g.id)).toContain("lots");
  });
  it("always returns something, and every guide has a unique id and text", () => {
    expect(pickGuides("zzzz qqqq").length).toBeGreaterThan(0);
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length);
    for (const g of GUIDES) expect(g.body.length).toBeGreaterThan(80);
  });
});

describe("input checks", () => {
  it("accepts alternating messages that end with a question, and refuses everything else", () => {
    expect(cleanMessages([{ role: "user", content: "hi" }])).toHaveLength(1);
    expect(cleanMessages([])).toBeNull();
    expect(cleanMessages([{ role: "assistant", content: "x" }])).toBeNull();
    expect(cleanMessages([{ role: "user", content: "a" }, { role: "user", content: "b" }])).toBeNull();
    expect(cleanMessages([{ role: "user", content: "x".repeat(2001) }])).toBeNull();
    expect(cleanMessages([{ role: "system", content: "x" }])).toBeNull();
    expect(cleanMessages("hello")).toBeNull();
  });
  it("describes only known kinds of page, never raw text from the address", () => {
    expect(pageContext("/")).toEqual({ kind: "the Events list" });
    const id = randomUUID();
    expect(pageContext(`/events/${id}?tab=x`)).toEqual({ kind: "an event page", eventId: id });
    expect(pageContext("/events/<script>").kind).not.toContain("<");
    expect(pageContext("/templates").kind).toBe("the templates page");
  });
  it("tells the model that tool and user text is data and that it is read-only", () => {
    const s = systemPrompt({ tenantName: "T", role: "member", page: "the Events list", eventLine: "", guides: "g" });
    expect(s).toMatch(/data, never instructions/);
    expect(s).toMatch(/read-only/);
    expect(s).toMatch(/Never ask for, repeat or store passwords/);
  });
});

describe("lookups", () => {
  it("list_events returns only this company's events the person may see", async () => {
    const a = JSON.parse(await runTool(pool, who(A), "list_events", {}));
    const b = JSON.parse(await runTool(pool, who(B), "list_events", {}));
    expect(a.total).toBe(2); expect(b.total).toBe(1);
    expect(JSON.stringify(a)).not.toMatch(/valueAed|value_aed|400000/);
    const open = JSON.parse(await runTool(pool, who(A), "list_events", { status: "open" }));
    expect(open.events.map((e: { status: string }) => e.status)).toEqual(["Open"]);
    const soon = JSON.parse(await runTool(pool, who(A), "list_events", { closing_within_days: 7 }));
    expect(soon.total).toBe(1);
  });
  it("event_status explains what is missing, and does not show another company's event", async () => {
    const a = JSON.parse(await runTool(pool, who(A), "list_events", { status: "draft" }));
    const ref = a.events[0].ref as string;
    const st = JSON.parse(await runTool(pool, who(A), "event_status", { ref }));
    expect(st.found).toBe(true);
    expect(st.checks.find((c: { check: string }) => c.check === "At least one item to price").ok).toBe(false);
    const bRef = JSON.parse(await runTool(pool, who(B), "list_events", {})).events[0].ref as string;
    const other = JSON.parse(await runTool(pool, who(A), "event_status", { ref: bRef + "X" }));
    expect(other.found).toBe(false);
    expect(JSON.parse(await runTool(pool, who(A), "nope", {})).error).toBeTruthy();
  });
});

describe("chat", () => {
  const reply = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  it("is off without a key and refuses bad input", async () => {
    expect(await chat(pool, who(A), { messages: [{ role: "user", content: "hi" }] }, { env: {} as NodeJS.ProcessEnv })).toMatchObject({ ok: false });
    expect(await chat(pool, who(A), { messages: [] }, { env, fetch: (() => { throw new Error("no call"); }) as unknown as typeof fetch })).toMatchObject({ ok: false });
  });
  it("runs a lookup, sends the result back to the model, returns the answer and logs it", async () => {
    const calls: { system: string; messages: { role: string; content: unknown }[] }[] = [];
    const fake = ((_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string); calls.push(body);
      if (calls.length === 1) return reply({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "list_events", input: { status: "open" } }] });
      return reply({ stop_reason: "end_turn", content: [{ type: "text", text: "One event is open." }] });
    }) as unknown as typeof fetch;
    const out = await chat(pool, who(A), { messages: [{ role: "user", content: "Which events are open?" }], path: "/" }, { env, fetch: fake });
    expect(out).toMatchObject({ ok: true, reply: "One event is open.", looked: ["list_events"] });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.system).toContain("Test Co");
    const last = calls[1]!.messages[calls[1]!.messages.length - 1]!;
    expect(JSON.stringify(last.content)).toContain("tool_result");
    expect(JSON.stringify(last.content)).toContain("Event in published");
    await new Promise((r) => setTimeout(r, 300));
    const row = (await admin.query(`select question, answer, looked from assistant_message where tenant_id = $1`, [A.tenantId])).rows[0];
    expect(row).toMatchObject({ question: "Which events are open?", answer: "One event is open.", looked: ["list_events"] });
    expect((await admin.query(`select count(*)::int n from assistant_message where tenant_id = $1`, [B.tenantId])).rows[0].n).toBe(0);
  });
  it("stops after a few lookups and fails politely when the model service is down", async () => {
    let n = 0;
    const loop = (() => { n++; return reply({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t" + n, name: "list_events", input: {} }] }); }) as unknown as typeof fetch;
    expect(await chat(pool, who(A), { messages: [{ role: "user", content: "loop" }] }, { env, fetch: loop })).toMatchObject({ ok: false });
    expect(n).toBe(4);
    const down = (() => Promise.resolve(new Response("x", { status: 500 }))) as unknown as typeof fetch;
    expect(await chat(pool, who(A), { messages: [{ role: "user", content: "hi" }] }, { env, fetch: down })).toMatchObject({ ok: false });
  });
  it("limits how often one person can ask", async () => {
    const ok = (() => reply({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] })) as unknown as typeof fetch;
    const w = { ...who(B), membershipId: B.people.admin.membershipId };
    const results = [];
    for (let i = 0; i < 12; i++) results.push((await chat(pool, w, { messages: [{ role: "user", content: "q" }] }, { env, fetch: ok })).ok);
    expect(results.filter(Boolean).length).toBe(10);
    const day = { ...who(B), membershipId: B.people.auditor.membershipId };
    const a = await chat(pool, day, { messages: [{ role: "user", content: "q" }] }, { env: { ...env, ASSISTANT_DAILY_LIMIT: "1" } as NodeJS.ProcessEnv, fetch: ok });
    const b = await chat(pool, day, { messages: [{ role: "user", content: "q" }] }, { env: { ...env, ASSISTANT_DAILY_LIMIT: "1" } as NodeJS.ProcessEnv, fetch: ok });
    expect(a.ok).toBe(true); expect(b).toMatchObject({ ok: false, error: expect.stringMatching(/today's limit/) });
  });
});
