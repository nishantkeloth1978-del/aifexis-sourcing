import type { Pool } from "pg";
import type { ScanReason, ScanStatus } from "./scanstatus-text";
export { describeScan } from "./scanstatus-text";
export type { ScanReason, ScanStatus } from "./scanstatus-text";

export async function recordScan(ok: boolean, reason?: ScanReason, pool?: Pool): Promise<void> {
  try {
    const p = pool ?? (await import("@/lib/db")).getPool();
    await p.query(`select service_status_record('scanner', $1, $2)`, [ok, reason ?? null]);
  } catch { /* status is informational */ }
}

export async function getScanStatus(pool: Pool, env: NodeJS.ProcessEnv = process.env): Promise<ScanStatus> {
  const r = (await pool.query(`select * from service_status_get('scanner')`)).rows[0];
  const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
  return { configured: Boolean(env.MALWARE_SCAN_URL), lastOkAt: iso(r?.last_ok_at), lastFailAt: iso(r?.last_fail_at), lastReason: r?.last_reason ?? null, okCount: Number(r?.ok_count ?? 0), failCount: Number(r?.fail_count ?? 0) };
}
