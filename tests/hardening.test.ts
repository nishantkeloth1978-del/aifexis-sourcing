import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allow, rateLimit } from "@/lib/ratelimit";
import { adminClient, makePool } from "./helpers/db";

let admin: Client, pool: Pool;
beforeAll(async () => { admin = await adminClient(); pool = makePool(); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("rate limiting", () => {
  it("allows up to the limit in a window, then refuses", async () => {
    const b = "t:" + Math.random();
    const out: boolean[] = [];
    for (let i = 0; i < 5; i++) out.push(await rateLimit(pool, b, 3600, 3));
    expect(out).toEqual([true, true, true, false, false]);
  });
  it("keeps buckets apart and a new window starts fresh", async () => {
    const a = "t:" + Math.random(), b = "t:" + Math.random();
    expect(await rateLimit(pool, a, 3600, 1)).toBe(true);
    expect(await rateLimit(pool, a, 3600, 1)).toBe(false);
    expect(await rateLimit(pool, b, 3600, 1)).toBe(true);
    await admin.query(`update rate_limit set window_start = window_start - interval '2 hours' where bucket = $1`, [a]);
    expect(await rateLimit(pool, a, 3600, 1)).toBe(true);
  });
  it("counts every limit even when one fails, and fails open when the database errors", async () => {
    const a = "t:" + Math.random(), b = "t:" + Math.random();
    expect(await allow(pool, [[a, 3600, 1], [b, 3600, 5]])).toBe(true);
    expect(await allow(pool, [[a, 3600, 1], [b, 3600, 5]])).toBe(false);
    expect((await admin.query(`select hits from rate_limit where bucket = $1`, [b])).rows[0].hits).toBe(2);
    const broken = { query: async () => { throw new Error("down"); } } as unknown as Pool;
    expect(await rateLimit(broken, "x", 60, 1)).toBe(true);
  });
  it("is not readable or writable by the tenant role, only through rate_hit", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query("set local role app_runtime");
      await expect(c.query(`select * from rate_limit`)).rejects.toThrow();
      await c.query("rollback");
      await c.query("begin"); await c.query("set local role app_runtime");
      expect((await c.query(`select rate_hit('t:role', 60, 5) as ok`)).rows[0].ok).toBe(true);
      await c.query("rollback");
    } finally { c.release(); }
  });
});
