import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient } from "./helpers/db";

let admin: Client;
beforeAll(async () => { admin = await adminClient(); });
afterAll(async () => { await admin.end(); });

describe("browser-facing roles are shut out (migration 0041)", () => {
  it("anon and authenticated have no privilege on any table or sequence in public", async () => {
    const r = await admin.query(`select grantee, table_name from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated')`);
    expect(r.rows).toEqual([]);
    const s = await admin.query(`select c.relname, r.rolname from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join pg_roles r
       where n.nspname = 'public' and c.relkind = 'S' and r.rolname in ('anon','authenticated') and has_sequence_privilege(r.rolname, c.oid, 'usage')`);
    expect(s.rows).toEqual([]);
  });
  it("no definer function can be run by anon, authenticated or PUBLIC", async () => {
    const r = await admin.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
    expect(r.rows).toEqual([]);
  });
  it("no function in public at all can be run by anon, authenticated or PUBLIC", async () => {
    const r = await admin.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
    expect(r.rows).toEqual([]);
  });
  it("a later table gets closed by the sweep that every migration calls", async () => {
    await admin.query(`create table zz_probe2 (id int)`);
    try {
      await admin.query(`select close_api_grants()`);
      const r = await admin.query(`select has_table_privilege('anon','zz_probe2','select') a`);
      expect(r.rows[0].a).toBe(false);
    } finally { await admin.query(`drop table zz_probe2`); }
  });
  it("every definer function fixes its search_path", async () => {
    const r = await admin.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig::text like '%search_path%', false)`);
    expect(r.rows).toEqual([]);
  });
  it("no default privilege (global or in public) hands new objects to anon or authenticated", async () => {
    const r = await admin.query(`select pg_get_userbyid(defaclrole) owner, defaclacl::text acl from pg_default_acl where defaclrole = (select oid from pg_roles where rolname = 'postgres') and defaclacl::text ~ '(anon|authenticated)='`);
    expect(r.rows).toEqual([]);
  });
  it("tables created later stay closed to the browser-facing roles", async () => {
    await admin.query(`create table zz_probe (id int)`);
    try {
      const r = await admin.query(`select has_table_privilege('anon','zz_probe','select') a, has_table_privilege('authenticated','zz_probe','select') b`);
      expect(r.rows[0]).toEqual({ a: false, b: false });
    } finally { await admin.query(`drop table zz_probe`); }
  });
  it("every table with a tenant column has row level security, and all but the definer-only reply_token force it", async () => {
    const r = await admin.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity) order by 1`);
    expect(r.rows.map((x) => x.relname)).toEqual(["reply_token"]);
    const off = await admin.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(off.rows).toEqual([]);
  });
});
