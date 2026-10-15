// The internal clock for the automatic steps. Run as a small always-on process: npx tsx scripts/worker.ts
// Needs DATABASE_URL (same value as the app). Optional WORKER_INTERVAL_SECONDS (15 to 600, default 60).
import { getPool } from "../src/lib/db";
import { runLoop } from "../src/automation/service";

const secs = Number(process.env.WORKER_INTERVAL_SECONDS ?? 60);
const intervalMs = (Number.isFinite(secs) ? Math.min(600, Math.max(15, secs)) : 60) * 1000;
const ctrl = new AbortController();
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => { console.log(`[worker] ${sig}, stopping after this pass`); ctrl.abort(); });

console.log(`[worker] started, one pass every ${intervalMs / 1000} seconds`);
runLoop(getPool(), { intervalMs, signal: ctrl.signal }).then(async () => { await getPool().end(); process.exit(0); });
