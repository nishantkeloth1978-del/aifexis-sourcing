import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chat, readStream, type StreamEvent } from "@/assistant/service";
import { parseClosing, proposeAction, resolveAction, A_GONE } from "@/assistant/actions";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, A: World, B: World, draftRef = "", openRef = "", bRef = "";
const who = (w: World, perms: string[] = ["event.read_all", "event.create"]): Who & { tenantName: string } => ({ tenantId: w.tenantId, userId: w.people.buyer.userId, membershipId: w.people.buyer.membershipId, role: "member", perms, tenantName: "Test Co" });
const env = { ANTHROPIC_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv;
const count = async (w: World, like = "%") => (await admin.query(`select count(*)::int n from sourcing_event where tenant_id = $1 and title like $2`, [w.tenantId, like])).rows[0].n as number;
const status = async (id: string) => (await admin.query(`select status from assistant_action where id = $1`, [id])).rows[0]?.status as string;

beforeAll(async () => {
  admin = await adminClient(); pool = makePool(); A = await seedTenant(admin, "act-a"); B = await seedTenant(admin, "act-b");
  const d = await makeEvent(admin, A, "draft"), o = await makeEvent(admin, A, "published"), b = await makeEvent(admin, B, "draft");
  const set = async (id: unknown, ref: string) => { await admin.query(`update sourcing_event set ref = $2 where id = $1`, [(id as { id?: string }).id ?? id, ref]); return ref; };
  draftRef = await set(d, "EV-ACT-D"); openRef = await set(o, "EV-ACT-O"); bRef = await set(b, "EV-ACT-B");
});
afterAll(async () => { await pool.end(); await admin.end(); });

describe("closing dates", () => {
  it("a bare date means 17:00 Gulf time; junk is refused", () => {
    expect(parseClosing("2026-11-30")).toEqual({ ok: true, iso: "2026-11-30T13:00:00.000Z" });
    expect(parseClosing("2026-11-30T09:00:00Z")).toEqual({ ok: true, iso: "2026-11-30T09:00:00.000Z" });
    expect(parseClosing("next friday").ok).toBe(false);
    expect(parseClosing("").ok).toBe(false);
  });
});

describe("proposals and confirmation", () => {
  it("a proposal changes nothing; Confirm runs it once, as that person", async () => {
    const before = await count(A);
    const p = await proposeAction(pool, who(A), { kind: "create_event", title: "Cable tray supply", department: "Projects", closing_date: "2026-12-15" });
    if (!p.ok) throw new Error(p.note);
    expect(p.proposal.summary.rows).toContainEqual(["Title", "Cable tray supply"]);
    expect(p.proposal.summary.rows).toContainEqual(["Closing date", "2026-12-15 13:00 UTC"]);
    expect(await count(A)).toBe(before);
    const r = await resolveAction(pool, who(A), p.proposal.id, "confirm");
    expect(r).toMatchObject({ ok: true, link: expect.stringMatching(/^\/events\//) });
    expect(await count(A)).toBe(before + 1);
    const ev = (await admin.query(`select state::text s, created_by, closes_at from sourcing_event where title = 'Cable tray supply'`)).rows[0];
    expect(ev.s).toBe("draft"); expect(ev.created_by).toBe(A.people.buyer.membershipId);
    expect(await status(p.proposal.id)).toBe("done");
    expect(await resolveAction(pool, who(A), p.proposal.id, "confirm")).toEqual({ ok: false, error: A_GONE });
    expect(await count(A, "Cable tray supply")).toBe(1);
  });
  it("Cancel does nothing, and a cancelled or expired proposal cannot be confirmed", async () => {
    const p = await proposeAction(pool, who(A), { kind: "create_event", title: "Never created" });
    if (!p.ok) throw new Error(p.note);
    expect(await resolveAction(pool, who(A), p.proposal.id, "cancel")).toMatchObject({ ok: true });
    expect(await resolveAction(pool, who(A), p.proposal.id, "confirm")).toEqual({ ok: false, error: A_GONE });
    const q = await proposeAction(pool, who(A), { kind: "create_event", title: "Too late" });
    if (!q.ok) throw new Error(q.note);
    await admin.query(`update assistant_action set created_at = now() - interval '20 minutes' where id = $1`, [q.proposal.id]);
    expect(await resolveAction(pool, who(A), q.proposal.id, "confirm")).toEqual({ ok: false, error: A_GONE });
    expect(await count(A, "Never created")).toBe(0); expect(await count(A, "Too late")).toBe(0);
  });
  it("only the person who was asked can decide, and never across companies", async () => {
    const p = await proposeAction(pool, who(A), { kind: "create_event", title: "Mine only" });
    if (!p.ok) throw new Error(p.note);
    const other = { ...who(A), membershipId: A.people.admin.membershipId, userId: A.people.admin.userId };
    expect(await resolveAction(pool, other, p.proposal.id, "confirm")).toEqual({ ok: false, error: A_GONE });
    expect(await resolveAction(pool, who(B), p.proposal.id, "confirm")).toEqual({ ok: false, error: A_GONE });
    expect(await count(A, "Mine only")).toBe(0);
    expect(await status(p.proposal.id)).toBe("proposed");
  });
  it("refuses a role that may not edit, bad input, unknown kinds, and other companies' events", async () => {
    expect(await proposeAction(pool, who(A, ["event.read_all"]), { kind: "create_event", title: "Nope nope" })).toMatchObject({ ok: false });
    expect(await proposeAction(pool, who(A), { kind: "create_event", title: "x" })).toMatchObject({ ok: false });
    expect(await proposeAction(pool, who(A), { kind: "create_event", title: "Fine title", closing_date: "soon" })).toMatchObject({ ok: false });
    expect(await proposeAction(pool, who(A), { kind: "publish_event", ref: draftRef })).toMatchObject({ ok: false });
    expect(await proposeAction(pool, who(A), { kind: "update_event", ref: bRef, title: "Hijack" })).toMatchObject({ ok: false, note: expect.stringMatching(/No event/) });
    expect(await proposeAction(pool, who(A), { kind: "update_event", ref: draftRef })).toMatchObject({ ok: false });
  });
  it("edits and adds items only on a draft", async () => {
    expect(await proposeAction(pool, who(A), { kind: "update_event", ref: openRef, title: "Changed title" })).toMatchObject({ ok: false, note: expect.stringMatching(/no longer a draft/) });
    expect(await proposeAction(pool, who(A), { kind: "add_item", ref: openRef, description: "Pump", quantity: "2", unit: "EA" })).toMatchObject({ ok: false });
    const u = await proposeAction(pool, who(A), { kind: "update_event", ref: draftRef, title: "Renamed by assistant", closing_date: "2027-01-20" });
    if (!u.ok) throw new Error(u.note);
    expect(await resolveAction(pool, who(A), u.proposal.id, "confirm")).toMatchObject({ ok: true });
    const row = (await admin.query(`select title, closes_at from sourcing_event where ref = $1 and tenant_id = $2`, [draftRef, A.tenantId])).rows[0];
    expect(row.title).toBe("Renamed by assistant"); expect(new Date(row.closes_at).toISOString()).toBe("2027-01-20T13:00:00.000Z");
    const i = await proposeAction(pool, who(A), { kind: "add_item", ref: draftRef, description: "Centrifugal pump", quantity: "3", unit: "EA" });
    if (!i.ok) throw new Error(i.note);
    expect(await resolveAction(pool, who(A), i.proposal.id, "confirm")).toMatchObject({ ok: true });
    expect((await admin.query(`select count(*)::int n from event_item i join sourcing_event e on e.id = i.event_id where e.ref = $1 and e.tenant_id = $2 and i.description = 'Centrifugal pump'`, [draftRef, A.tenantId])).rows[0].n).toBe(1);
    const c = await proposeAction(pool, who(A), { kind: "duplicate_event", ref: draftRef });
    if (!c.ok) throw new Error(c.note);
    expect(await resolveAction(pool, who(A), c.proposal.id, "confirm")).toMatchObject({ ok: true, link: expect.stringMatching(/^\/events\//) });
    expect(await count(A, "Renamed by assistant (copy)")).toBe(1);
  });
  it("a permission lost between proposal and Confirm blocks the change", async () => {
    const p = await proposeAction(pool, who(A), { kind: "create_event", title: "Lost permission" });
    if (!p.ok) throw new Error(p.note);
    expect(await resolveAction(pool, who(A, ["event.read_all"]), p.proposal.id, "confirm")).toMatchObject({ ok: false });
    expect(await count(A, "Lost permission")).toBe(0);
  });
});

const sse = (events: unknown[]) => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (const ev of events) c.enqueue(e.encode(`event: x\ndata: ${JSON.stringify(ev)}\n\n`)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
const textTurn = (parts: string[]) => [
  { type: "message_start" }, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  ...parts.map((t) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } })),
  { type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" }];

describe("streaming", () => {
  it("reads text pieces and a tool call out of an event stream", async () => {
    const got: string[] = [];
    const r = await readStream(sse([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me " } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "look." } }, { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "list_events", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"status\":" } }, { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "\"open\"}" } }, { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } }]), (t) => got.push(t));
    expect(got.join("")).toBe("Let me look.");
    expect(r.stop).toBe("tool_use");
    expect(r.content[1]).toMatchObject({ type: "tool_use", id: "t1", name: "list_events", input: { status: "open" } });
  });
  it("streams the answer to the browser piece by piece and ends with the full result", async () => {
    const calls: { stream?: boolean }[] = [];
    const fake = ((_u: string, init: RequestInit) => { calls.push(JSON.parse(init.body as string)); return Promise.resolve(sse(textTurn(["Click ", "Templates."]))); }) as unknown as typeof fetch;
    const ev: StreamEvent[] = [];
    const out = await chat(pool, { ...who(B), membershipId: B.people.requester.membershipId }, { messages: [{ role: "user", content: "Where are templates?" }] }, { env, fetch: fake }, (e) => ev.push(e));
    expect(calls[0]!.stream).toBe(true);
    expect(ev.filter((e) => e.t === "delta").map((e) => (e as { x: string }).x)).toEqual(["Click ", "Templates."]);
    expect(out).toMatchObject({ ok: true, reply: "Click Templates.", proposals: [] });
  });
  it("tells the browser to start the text over when the model goes off to look something up", async () => {
    let n = 0;
    const fake = (() => { n++; return Promise.resolve(n === 1
      ? sse([{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Checking…" } }, { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "list_events", input: {} } }, { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } }, { type: "content_block_stop", index: 1 }, { type: "message_delta", delta: { stop_reason: "tool_use" } }])
      : sse(textTurn(["Two events."]))); }) as unknown as typeof fetch;
    const ev: StreamEvent[] = [];
    const out = await chat(pool, { ...who(A), membershipId: A.people.auditor.membershipId }, { messages: [{ role: "user", content: "events?" }] }, { env, fetch: fake }, (e) => ev.push(e));
    expect(ev.map((e) => e.t)).toEqual(["delta", "round", "delta"]);
    expect(out).toMatchObject({ ok: true, reply: "Two events." });
  });
});

describe("the model proposing a change", () => {
  it("returns a card built by the server, runs nothing, and allows one change per reply", async () => {
    let n = 0;
    const fake = (() => { n++; return Promise.resolve(new Response(JSON.stringify(n === 1
      ? { stop_reason: "tool_use", content: [
        { type: "tool_use", id: "p1", name: "propose_action", input: { kind: "create_event", title: "Chat created event", closing_date: "2026-12-01" } },
        { type: "tool_use", id: "p2", name: "propose_action", input: { kind: "create_event", title: "Second one" } }] }
      : { stop_reason: "end_turn", content: [{ type: "text", text: "Prepared. Please confirm." }] }), { status: 200, headers: { "content-type": "application/json" } })); }) as unknown as typeof fetch;
    const w = { ...who(A), membershipId: A.people.admin.membershipId, userId: A.people.admin.userId };
    const before = await count(A);
    const out = await chat(pool, w, { messages: [{ role: "user", content: "Create an event called Chat created event closing 1 Dec" }] }, { env, fetch: fake });
    if (!out.ok) throw new Error(out.error);
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0]!.summary.title).toBe("Create a new event");
    expect(await count(A)).toBe(before);
    expect((await admin.query(`select count(*)::int n from assistant_action where tenant_id = $1 and membership_id = $2 and status = 'proposed' and params->>'title' = 'Chat created event'`, [A.tenantId, A.people.admin.membershipId])).rows[0].n).toBe(1);
  });
});
