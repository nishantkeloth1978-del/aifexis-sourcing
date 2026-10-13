-- Release 1 (R1-4, second pass): a re-runnable sweep, after the first audit on the live project.
-- Found by the audit: Supabase's own helper rls_auto_enable() (a definer function) was callable by anon and authenticated, and
-- harmless helper functions were callable by everyone. New tables created by later migrations can also pick up Supabase's
-- default grants, so the sweep is a function that every later migration ends by calling:   select close_api_grants();

create or replace function close_api_grants() returns void language plpgsql as $$
declare r text; f record;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables    in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
    end if;
  end loop;
  -- Functions: nobody by default. Our own roles get the plain helpers (row security and checks call them);
  -- definer functions keep exactly the explicit grants their migration gave them.
  for f in
    select p.oid, p.prosecdef, p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    begin
      execute format('revoke all on function %s from public', f.sig);
      if not f.prosecdef then
        execute format('grant execute on function %s to app_runtime, app_supplier', f.sig);
      end if;
    exception when insufficient_privilege then
      raise notice 'Skipped %: not owned by this user.', f.sig;
    end;
  end loop;
end $$;
revoke all on function close_api_grants() from public;

select close_api_grants();

-- Default privileges of the role that owns our objects (repeats 0041 in case that step was skipped or run from an older copy).
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      begin
        execute format('alter default privileges for role postgres revoke all on tables    from %I', r);
        execute format('alter default privileges for role postgres revoke all on sequences from %I', r);
        execute format('alter default privileges for role postgres revoke all on functions from %I', r);
        execute format('alter default privileges for role postgres in schema public revoke all on tables    from %I', r);
        execute format('alter default privileges for role postgres in schema public revoke all on sequences from %I', r);
        execute format('alter default privileges for role postgres in schema public revoke all on functions from %I', r);
      exception when others then
        raise notice 'Default privileges not changed: %', sqlerrm;
      end;
    end if;
  end loop;
end $$;

-- Shows what is left (should list only supabase_admin rows, which this user cannot change and which do not affect our objects).
select pg_get_userbyid(d.defaclrole) as owner, d.defaclnamespace::regnamespace::text as schema, d.defaclobjtype as kind, d.defaclacl::text as acl
  from pg_default_acl d where d.defaclacl::text ~ '(anon|authenticated)=' and pg_get_userbyid(d.defaclrole) = 'postgres';
