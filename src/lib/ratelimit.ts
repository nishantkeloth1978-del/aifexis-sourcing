import type { Pool } from "pg";

export const TOO_MANY = "Too many attempts. Wait a few minutes and try again.";
export const TOO_FAST = "Too many requests. Wait a moment and try again.";

/**
 * Counts one hit against a fixed window kept in Postgres. Returns true when the caller may go on.
 * If the limiter itself fails (database trouble) it lets the request through: the request will meet the same problem anyway,
 * and a broken limiter must not lock everyone out.
 */
export async function rateLimit(pool: Pool, bucket: string, windowSecs: number, max: number): Promise<boolean> {
  try {
    const r = await pool.query(`select rate_hit($1, $2, $3) as ok`, [bucket.slice(0, 300), windowSecs, max]);
    return r.rows[0]?.ok === true;
  } catch (e) {
    console.error("[ratelimit] failed open:", (e as Error).message);
    return true;
  }
}

/** All limits that apply to one request must pass. Every limit is counted even after one fails, so a flood stays blocked. */
export async function allow(pool: Pool, limits: [bucket: string, windowSecs: number, max: number][]): Promise<boolean> {
  let ok = true;
  for (const [b, w, m] of limits) if (!(await rateLimit(pool, b, w, m))) ok = false;
  return ok;
}
