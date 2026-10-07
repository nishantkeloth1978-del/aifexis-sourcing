import { Pool } from "pg";

let pool: Pool | undefined;

/** Shared pool. DATABASE_URL must connect as a role that can `set local role app_runtime`. */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString, max: 5, ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false } });
  }
  return pool;
}
