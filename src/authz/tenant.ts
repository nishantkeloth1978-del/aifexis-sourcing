import type { Pool, PoolClient } from "pg";

/** The database role every request runs as. The supplier-only deployment sets DB_RUNTIME_ROLE=app_supplier, which can read and write far less. */
export function runtimeRole(env: Record<string, string | undefined> = process.env): "app_runtime" | "app_supplier" {
  return env.DB_RUNTIME_ROLE === "app_supplier" ? "app_supplier" : "app_runtime";
}

/**
 * Runs fn in one transaction as the restricted runtime role with the tenant set transaction-locally.
 * Because the setting is local to the transaction, a pooled connection cannot carry a tenant into the next request.
 */
export async function withTenant<T>(pool: Pool, tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${runtimeRole()}`);
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
