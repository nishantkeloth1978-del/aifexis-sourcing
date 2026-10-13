import { Pool } from "pg";
import { sslFor, type SslMode } from "./dbssl";

let pool: Pool | undefined;

/** Shared pool. DATABASE_URL must connect as a role that can `set local role app_runtime`. */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString, max: 5, ssl: sslFor(connectionString).options });
  }
  return pool;
}

/** Whether the database certificate is verified (shown on /api/health; never the certificate itself). */
export const dbTlsMode = (): SslMode => (process.env.DATABASE_URL ? sslFor(process.env.DATABASE_URL).mode : "none");
