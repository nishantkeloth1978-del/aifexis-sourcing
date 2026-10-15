import type { Pool } from "pg";
import type { AiStatus, Reason } from "./aistatus-text";
export { describeAi, reasonFor } from "./aistatus-text";
export type { AiStatus, Reason } from "./aistatus-text";

/**
 * Health of the Anthropic key, kept as one platform row (no key material, no content): when a call last worked, when one last failed and a short reason code.
 * Recording never blocks or breaks an AI feature.
 */


export async function recordAi(ok: boolean, reason?: Reason, pool?: Pool): Promise<void> {
  try {
    const p = pool ?? (await import("@/lib/db")).getPool();
    await p.query(`select ai_status_record($1, $2)`, [ok, reason ?? null]);
  } catch { /* status is informational */ }
}

/** `keySet`: whether the company has entered a Claude key (Configuration → Assistant models). Without it, `env` is checked (tests). */
export async function getAiStatus(pool: Pool, env: NodeJS.ProcessEnv = {} as NodeJS.ProcessEnv, keySet?: boolean): Promise<AiStatus> {
  const r = (await pool.query(`select * from ai_status_get()`)).rows[0];
  const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
  return { keySet: keySet ?? Boolean(env.ANTHROPIC_API_KEY), lastOkAt: iso(r?.last_ok_at), lastFailAt: iso(r?.last_fail_at), lastReason: r?.last_reason ?? null, okCount: Number(r?.ok_count ?? 0), failCount: Number(r?.fail_count ?? 0) };
}

