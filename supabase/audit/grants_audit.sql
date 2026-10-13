-- READ-ONLY. Run in the Supabase SQL Editor and send back the result of each query. Changes nothing.

-- 1. Tables in public that anon or authenticated can touch (expected: no rows after migration 0041)
select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
 group by grantee, table_name order by table_name, grantee;

-- 2. Functions in public executable by anon, authenticated or PUBLIC, with definer flag (expected: only harmless helpers, no definer functions)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and (p.prosecdef or has_function_privilege('anon', p.oid, 'execute'))
 order by p.prosecdef desc, p.proname;

-- 3. Definer functions without a fixed search_path (expected: no rows)
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig::text like '%search_path%', false);

-- 4. Tables in public without row level security (expected: only tenant-independent tables you know about)
select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1;

-- 5. Default privileges that would re-open access on future objects (expected: no rows mentioning anon or authenticated)
select pg_get_userbyid(d.defaclrole) as owner, d.defaclobjtype as kind, d.defaclacl::text as acl
  from pg_default_acl d where d.defaclacl::text ~ '(anon|authenticated)=';
