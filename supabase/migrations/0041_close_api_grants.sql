-- Release 1 (R1-4): close the Supabase Data API and function-execution gaps.
-- 1. Browser-facing roles (anon, authenticated) get no access to anything in schema public. The app reaches the database
--    only through the server-side login role, never through the Data API.
-- 2. Four SECURITY DEFINER functions were still executable by PUBLIC; they now have an explicit caller list.
-- 3. Default privileges are closed so objects created later do not re-open the gap.
-- Safe to re-run. Roles that do not exist (plain PostgreSQL) are skipped.

revoke all on function supplier_outcome(uuid, uuid)       from public;
revoke all on function event_base_gates(uuid)             from public;
revoke all on function issue_reply_token(uuid, uuid)      from public;
revoke all on function resolve_reply_token(text)          from public;
grant execute on function supplier_outcome(uuid, uuid), event_base_gates(uuid), issue_reply_token(uuid, uuid), resolve_reply_token(text) to app_runtime, app_supplier;

do $$
declare r text; o text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables    in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      -- Default privileges can only be changed for roles the current user may act as. In the Supabase SQL Editor that is postgres
      -- (which owns everything our migrations create); supabase_admin is skipped when it is refused.
      foreach o in array array['postgres', 'supabase_admin'] loop
        if exists (select 1 from pg_roles where rolname = o) then
          begin
            -- Supabase sets these defaults for ALL schemas (no "in schema"), so both forms are needed: the global one removes theirs.
            execute format('alter default privileges for role %I revoke all on tables    from %I', o, r);
            execute format('alter default privileges for role %I revoke all on sequences from %I', o, r);
            execute format('alter default privileges for role %I revoke all on functions from %I', o, r);
            execute format('alter default privileges for role %I in schema public revoke all on tables    from %I', o, r);
            execute format('alter default privileges for role %I in schema public revoke all on sequences from %I', o, r);
            execute format('alter default privileges for role %I in schema public revoke all on functions from %I', o, r);
          exception when insufficient_privilege then
            raise notice 'Skipped default privileges of role % (not permitted for this user); objects created by that role are not ours.', o;
          end;
        end if;
      end loop;
    end if;
  end loop;
end $$;

-- reply_token is reached only through its two definer functions; row level security is a second lock on it.
alter table reply_token enable row level security;
