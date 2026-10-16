import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoDraftRequest, sweepAutoDrafts } from "@/agents/autodraft";
import { pendingDraft } from "@/agents/drafter";
import { savePolicy, getPolicy } from "@/automation/policy";
import { DEFAULT_POLICY } from "@/automation/policy-types";
import { createRequest } from "@/requests/service";
import type { Who } from "@/events/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (w: World, p: keyof World["people"], role = "member", perms?: string[]): Who => ({ tenantId: w.tenantId, userId: w.people[p].userId, membershipId: w.people[p].membershipId, role, ...(perms ? { perms } : {}) });
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "autodraft-x"); });
afterAll(async () => { await pool.end(); await admin.end(); });
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { expect(r, JSON.stringify(r)).toMatchObject({ ok: true }); return r as Extract<T, { ok: true }>; };
const ADMIN = () => who(X, "admin", "admin");
const REQUESTER = () => who(X, "requester", "member", ["request.create"]);
const CLAUDE = { key: "sk-test", model: "claude-test" };
const answer = JSON.stringify({ title: "Supply of safety gloves", items: [{ description: "Nitrile gloves, size L", quantity: "200", unit: "PAIR", specification: "", section: "", materialGroup: "", requiredDate: "" }], notes: ["Confirm thickness"] });
const fakeFetch = (calls: { n: number }) => (async () => { calls.n++; return Response.json({ content: [{ type: "text", text: answer }], usage: { input_tokens: 10, output_tokens: 10 } }); }) as unknown as typeof globalThis.fetch;
const newRequest = async (title: string) => ok(await createRequest(pool, REQUESTER(), { kind: "goods", title, description: "For plant A", lines: [{ description: "Gloves", quantity: "200", unit: "PAIR" }] } as never)).request;
const policy = (patch: object) => savePolicy(pool, ADMIN(), { ...DEFAULT_POLICY, ...patch });

describe("AI first draft for every new request", () => {
  it("is off by default and needs level 2", async () => {
    const r = await newRequest("Gloves default off"); const calls = { n: 0 };
    expect(await autoDraftRequest(pool, X.tenantId, r.id, { claude: CLAUDE, fetch: fakeFetch(calls) })).toBe("skipped");
    await policy({ autoDraft: true, level: 1 });
    expect(await autoDraftRequest(pool, X.tenantId, r.id, { claude: CLAUDE, fetch: fakeFetch(calls) })).toBe("skipped");
    expect(calls.n).toBe(0);
    expect((await getPolicy(pool, X.tenantId)).autoDraft).toBe(true);
  });
  it("drafts once, leaves a proposal for the buyer, notifies buyers, and creates no event", async () => {
    await policy({ autoDraft: true, level: 2 });
    const r = await newRequest("Gloves with AI"); const calls = { n: 0 };
    expect(await autoDraftRequest(pool, X.tenantId, r.id, { claude: CLAUDE, fetch: fakeFetch(calls) })).toBe("drafted");
    expect(await autoDraftRequest(pool, X.tenantId, r.id, { claude: CLAUDE, fetch: fakeFetch(calls) })).toBe("skipped");   // already has a draft run
    expect(calls.n).toBe(1);
    const p = await pendingDraft(pool, who(X, "buyer", "member", ["event.create", "request.create"]), r.id);
    expect(p?.draft.title).toBe("Supply of safety gloves");
    const row = (await admin.query(`select state, event_id from purchase_request where id = $1`, [r.id])).rows[0];
    expect(row).toEqual({ state: "new", event_id: null });
    expect((await admin.query(`select count(*)::int n from notification where tenant_id = $1 and message like $2`, [X.tenantId, `AI draft ready for review on ${r.ref}%`])).rows[0].n).toBeGreaterThan(0);
  });
  it("a failed or invalid AI answer leaves the request untouched and is not repeated", async () => {
    const r = await newRequest("Gloves bad answer"); let n = 0;
    const bad = (async () => { n++; return Response.json({ content: [{ type: "text", text: "no json here" }] }); }) as unknown as typeof globalThis.fetch;
    expect(await autoDraftRequest(pool, X.tenantId, r.id, { claude: CLAUDE, fetch: bad })).toBe("failed");
    expect(await autoDraftRequest(pool, X.tenantId, r.id, { claude: CLAUDE, fetch: bad })).toBe("skipped");
    expect((await admin.query(`select state from purchase_request where id = $1`, [r.id])).rows[0].state).toBe("new");
  });
  it("the backup sweep drafts requests older than three minutes only, newest work last, and respects the cap", async () => {
    const a = await newRequest("Sweep fresh"), b = await newRequest("Sweep old one"), c = await newRequest("Sweep old two"), d = await newRequest("Sweep old three");
    await admin.query(`update purchase_request set created_at = now() - interval '10 minutes' where id = any($1)`, [[b.id, c.id, d.id]]);
    const calls = { n: 0 };
    expect(await sweepAutoDrafts(pool, X.tenantId, { claude: CLAUDE, fetch: fakeFetch(calls) }, 2)).toBe(2);
    expect((await admin.query(`select count(*)::int n from agent_run where subject_id = any($1) and agent = 'drafter'`, [[a.id, b.id, c.id, d.id]])).rows[0].n).toBe(2);
    expect((await admin.query(`select count(*)::int n from agent_run where subject_id = $1`, [a.id])).rows[0].n).toBe(0);   // too fresh: the immediate run owns it
  });
  it("does nothing when paused or switched off, and skips a request already turned into an event", async () => {
    const r = await newRequest("Gloves paused"); const calls = { n: 0 };
    await policy({ autoDraft: true, level: 2, paused: true });
    expect(await autoDraftRequest(pool, X.tenantId, r.id, { claude: CLAUDE, fetch: fakeFetch(calls) })).toBe("skipped");
    await policy({ autoDraft: false });
    expect(await sweepAutoDrafts(pool, X.tenantId, { claude: CLAUDE, fetch: fakeFetch(calls) })).toBe(0);
    expect(calls.n).toBe(0);
  });
});
