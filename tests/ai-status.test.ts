import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeAi, getAiStatus, reasonFor, recordAi } from "@/lib/aistatus";
import { adminClient, makePool } from "./helpers/db";

let admin: Client, pool: Pool;
beforeAll(async () => { admin = await adminClient(); pool = makePool(); await admin.query(`delete from ai_status`); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("AI status", () => {
  it("maps HTTP status to a reason", () => {
    expect(reasonFor(401)).toBe("key_rejected"); expect(reasonFor(403)).toBe("key_rejected");
    expect(reasonFor(429)).toBe("rate_limited"); expect(reasonFor(503)).toBe("service_error"); expect(reasonFor(400)).toBe("bad_request");
  });
  it("records successes and failures through the runtime role and never stores key material", async () => {
    const empty = await getAiStatus(pool, { ANTHROPIC_API_KEY: "" } as unknown as NodeJS.ProcessEnv);
    expect(empty).toMatchObject({ keySet: false, lastOkAt: null, lastFailAt: null, okCount: 0, failCount: 0 });
    await recordAi(false, "key_rejected", pool);
    let s = await getAiStatus(pool, { ANTHROPIC_API_KEY: "sk-secret" } as unknown as NodeJS.ProcessEnv);
    expect(s).toMatchObject({ keySet: true, lastReason: "key_rejected", failCount: 1, okCount: 0 });
    expect(describeAi(s)).toMatchObject({ level: "bad" });
    await new Promise((r) => setTimeout(r, 15));
    await recordAi(true, undefined, pool);
    s = await getAiStatus(pool, { ANTHROPIC_API_KEY: "sk-secret" } as unknown as NodeJS.ProcessEnv);
    expect(s).toMatchObject({ okCount: 1, failCount: 1 });
    expect(describeAi(s)).toEqual({ level: "ok", text: "Working." });
    expect(JSON.stringify(s)).not.toContain("sk-secret");
    const cols = (await admin.query(`select column_name from information_schema.columns where table_name = 'ai_status'`)).rows.map((r) => r.column_name);
    expect(cols).not.toContain("key");
  });
  it("describes the not-configured and not-used-yet states", () => {
    expect(describeAi({ keySet: false, lastOkAt: null, lastFailAt: null, lastReason: null, okCount: 0, failCount: 0 }).level).toBe("off");
    expect(describeAi({ keySet: true, lastOkAt: null, lastFailAt: null, lastReason: null, okCount: 0, failCount: 0 }).level).toBe("idle");
  });
  it("is closed to the public API roles and to direct table access", async () => {
    const r = (await admin.query(`select has_table_privilege('app_runtime', 'ai_status', 'select') as a`)).rows[0];
    expect(r.a).toBe(false);
    for (const role of ["anon", "authenticated"]) {
      const e = (await admin.query(`select exists(select 1 from pg_roles where rolname = $1) as e`, [role])).rows[0].e;
      if (e) expect((await admin.query(`select has_function_privilege($1, 'ai_status_get()', 'execute') as a`, [role])).rows[0].a).toBe(false);
    }
  });
});
