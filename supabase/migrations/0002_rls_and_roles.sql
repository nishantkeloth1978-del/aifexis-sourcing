-- Tenant isolation (defence in depth). Envelope and role rules are enforced by the authorization service in src/authz.
-- The tenant is taken from a transaction-local setting so pooled connections cannot carry it between requests:
--   begin; set local role app_runtime; select set_config('app.tenant_id', '<uuid>', true); ... commit;

create function current_tenant() returns uuid
  language sql stable as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

do $$
declare t text;
begin
  foreach t in array array[
    'membership', 'supplier_org', 'supplier_user', 'tenant_config', 'sourcing_event', 'event_member',
    'delegation', 'invitation', 'qualified_bidder', 'opening_record', 'clarification', 'bid_revision',
    'bid_item', 'derived_item', 'stored_object', 'gate_result', 'tech_score', 'tech_result',
    'calculation_run', 'approval', 'break_glass_grant', 'audit_event', 'outbox'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())', t);
  end loop;
end $$;

-- Runtime role used by the application for all tenant-scoped work. It cannot bypass RLS.
-- On Supabase, grant this role to the connecting role (e.g. authenticator) or use your own pooled login role.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime nologin;
  end if;
end $$;

grant usage on schema public to app_runtime;
grant select, insert, update, delete on all tables in schema public to app_runtime;
grant usage, select on all sequences in schema public to app_runtime;
-- app_user holds only login identities and has no tenant column; the application never lists it for other tenants.
