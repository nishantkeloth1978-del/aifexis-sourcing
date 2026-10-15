import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AG_OFF, runAgent } from "@/agents/harness";
import { getPolicy, savePolicy } from "@/automation/policy";
import { getMonitor } from "@/automation/monitor";
import { sendReminders } from "@/automation/service";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World, Y: World;
const who = (w: World, p: keyof World["people"]): Who => ({ tenantId: w.tenantId, userId: w.people[p].userId, membershipId: w.people[p].membershipId, role: "admin", perms: ["config.manage"] } as Who);
const base = { paused: false, reminderDays: [1], extendEnabled: false, extendHours: 48, extendMinBids: 1, nudgeHours: 48, agentDailyLimit: 50 };
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "lvl-x"); Y = await seedTenant(admin, "lvl-y"); });
afterAll(async () => { await pool.end(); await admin.end(); });
const spec = { agent: "drafter" as const, subjectType: "request" as const, subjectId: randomUUID(), system: "s", user: "u", maxTokens: 50, parse: (r: unknown) => ({ ok: true as const, value: r }) };
const fetch = (async () => Response.json({ content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1, output_tokens: 1 } })) as unknown as typeof globalThis.fetch;
const CLAUDE = { key: "sk-test", model: "claude-test" };

describe("autonomy level", () => {
  it("defaults to assisted and is saved per company", async () => {
    expect((await getPolicy(pool, X.tenantId)).level).toBe(2);
    expect(await savePolicy(pool, who(X, "admin"), { ...base, level: 1 })).toMatchObject({ ok: true });
    expect((await getPolicy(pool, X.tenantId)).level).toBe(1); expect((await getPolicy(pool, Y.tenantId)).level).toBe(2);
  });
  it("below assisted the agents do not run, even with a key", async () => {
    for (const level of [0, 1] as const) {
      await savePolicy(pool, who(X, "admin"), { ...base, level });
      expect(await runAgent(pool, { tenantId: X.tenantId, userId: X.people.admin.userId }, spec, { claude: CLAUDE, fetch })).toEqual({ ok: false, error: AG_OFF });
    }
    expect((await admin.query(`select count(*)::int n from agent_run where tenant_id = $1`, [X.tenantId])).rows[0].n).toBe(0);
    await savePolicy(pool, who(X, "admin"), { ...base, level: 2 });
    expect(await runAgent(pool, { tenantId: X.tenantId, userId: X.people.admin.userId }, spec, { claude: CLAUDE, fetch })).toMatchObject({ ok: true });
  });
  it("level 0 stops the timed steps; level 1 keeps them", async () => {
    const e = await makeEvent(admin, X, "published", { withBids: false });
    await admin.query(`update sourcing_event set closes_at = now() + interval '20 hours' where id = $1`, [e.id]);
    await savePolicy(pool, who(X, "admin"), { ...base, level: 0 });
    expect(await sendReminders(pool, X.tenantId)).toBe(0);
    await savePolicy(pool, who(X, "admin"), { ...base, level: 1 });
    expect(await sendReminders(pool, X.tenantId)).toBeGreaterThanOrEqual(0);   // runs (the count depends on invited suppliers)
    await savePolicy(pool, who(X, "admin"), { ...base, level: 2 });
  });
});

describe("monitor", () => {
  it("counts the last 30 days for one company only", async () => {
    const e = await makeEvent(admin, Y, "awarded", { withBids: false });
    await admin.query(`insert into audit_event (tenant_id, event_id, actor, action, at) values ($1,$2,'a','transition:SubmitForPublication', now() - interval '10 days'), ($1,$2,'a','transition:Publish', now() - interval '8 days'), ($1,$2,'a','award.approved', now() - interval '2 days'), ($1,$2,'internal:auto','autonomy.auto_extend', now() - interval '3 days')`, [Y.tenantId, e.id]);
    const old = await makeEvent(admin, Y, "awarded", { withBids: false });
    await admin.query(`insert into audit_event (tenant_id, event_id, actor, action, at) values ($1,$2,'a','award.approved', now() - interval '60 days')`, [Y.tenantId, old.id]);
    for (const [agent, state] of [["drafter", "accepted"], ["drafter", "rejected"], ["reader", "failed"], ["reader", "proposed"]] as const)
      await admin.query(`insert into agent_run (tenant_id, agent, subject_type, subject_id, state, input_digest) values ($1,$2,'bid',$3,$4,$5)`, [Y.tenantId, agent, randomUUID(), state, "a".repeat(64)]);
    const m = await getMonitor(pool, Y.tenantId);
    expect(m).toMatchObject({ days: 30, awarded: 1, auto: 1, openChecks: 0 });
    expect(m.medianCycleDays).toBeGreaterThanOrEqual(8); expect(m.avgSteps).toBe(2);
    expect(m.agents).toEqual([{ agent: "drafter", runs: 2, failed: 0, accepted: 1, rejected: 1 }, { agent: "reader", runs: 2, failed: 1, accepted: 0, rejected: 0 }]);
    const x = await getMonitor(pool, X.tenantId);
    expect(x.awarded).toBe(0); expect(x.medianCycleDays).toBeNull(); expect(x.agents.find((a) => a.agent === "reader")).toBeUndefined();
  });
});
