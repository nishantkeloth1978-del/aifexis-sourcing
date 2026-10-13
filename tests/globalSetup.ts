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
    if (process.env.SKIP_DB_TESTS === "1") {
      console.warn("[globalSetup] database not reachable; SKIP_DB_TESTS=1, database tests will fail on their own:", (e as Error).message);
      process.env.TEST_DATABASE_UNAVAILABLE = "1";
      return;
    }
    throw new Error(
      `PostgreSQL is not reachable at ${adminUrl().replace(/:[^:@/]*@/, ":***@")} (${(e as Error).message}). ` +
      `The tests need a PostgreSQL 15+ server with a superuser. Start one on port 5499, or set ADMIN_DATABASE_URL to a superuser connection string. ` +
      `Set SKIP_DB_TESTS=1 only to run the tests that need no database.`);
  }
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();
  const db = new Client({ connectionString: testUrl() });
  await db.connect();
  // Imitate Supabase: browser-facing roles exist and new objects are granted to them by default. Migration 0041 must close that.
  await db.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;
    grant usage on schema public to anon, authenticated;
    alter default privileges grant all on tables to anon, authenticated;
    alter default privileges grant all on sequences to anon, authenticated;
    alter default privileges grant all on functions to anon, authenticated;`);
  const dir = path.resolve(__dirname, "../supabase/migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await db.query(fs.readFileSync(path.join(dir, f), "utf8"));
  }
  await db.end();
}
