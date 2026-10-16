import type { Pool } from "pg";

/** One check per migration that added something the code depends on: a table, or a table.column. Add a line with each new migration. */
export const PROBES: { migration: string; what: string }[] = [
  { migration: "0042", what: "bid_draft" }, { migration: "0055", what: "autonomy_policy" }, { migration: "0058", what: "purchase_request" },
  { migration: "0059", what: "integration_client" }, { migration: "0059", what: "webhook_delivery" }, { migration: "0060", what: "agent_run" },
  { migration: "0060", what: "autonomy_policy.agent_daily_limit" }, { migration: "0061", what: "bid_check" }, { migration: "0062", what: "autonomy_policy.level" }, { migration: "0063", what: "erp_mapping" }, { migration: "0064", what: "ariba_mapping" }, { migration: "0065", what: "integration_client.auto_event" }, { migration: "0066", what: "autonomy_policy.auto_draft" }, { migration: "0067", what: "sourcing_event.autopilot_hold" },
];

/** Which migrations are missing, found by looking for what they create. Run SQL migrations in the Supabase SQL Editor in order; this tells you which one was skipped. */
export async function missingMigrations(pool: Pick<Pool, "query">, probes = PROBES): Promise<string[]> {
  const missing = new Set<string>();
  for (const p of probes) {
    const [table, column] = p.what.split(".");
    // pg_catalog is readable by every login, so a narrow role (the supplier site) still sees tables it has no rights on.
    const r = column
      ? await pool.query(`select 1 from pg_attribute a where a.attrelid = to_regclass('public.' || $1) and a.attname = $2 and not a.attisdropped`, [table, column])
      : await pool.query(`select 1 where to_regclass('public.' || $1) is not null`, [table]);
    if (!r.rowCount) missing.add(p.migration);
  }
  return [...missing].sort();
}
