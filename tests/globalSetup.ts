import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";

/**
 * Creates a throwaway database from the Supabase migrations before the tests run.
 * Requires a superuser connection (ADMIN_DATABASE_URL). Used only for tests.
 */
export const TEST_DB = "aifexis_test";

export function adminUrl(): string {
  return process.env.ADMIN_DATABASE_URL ?? "postgresql://postgres@localhost:5499/postgres";
}
export function testUrl(): string {
  const u = new URL(adminUrl());
  u.pathname = "/" + TEST_DB;
  return u.toString();
}

export default async function setup() {
  process.env.TEST_DATABASE_URL = testUrl();
  const admin = new Client({ connectionString: adminUrl() });
  try {
    await admin.connect();
  } catch (e) {
    // Engine tests need no database; DB tests will report the connection problem themselves.
    console.warn("[globalSetup] database not reachable, skipping database creation:", (e as Error).message);
    process.env.TEST_DATABASE_UNAVAILABLE = "1";
    return;
  }
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();
  const db = new Client({ connectionString: testUrl() });
  await db.connect();
  const dir = path.resolve(__dirname, "../supabase/migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await db.query(fs.readFileSync(path.join(dir, f), "utf8"));
  }
  await db.end();
}
