-- Add another person to your tenant. Steps:
--  1. Supabase > Authentication > Users > Add user (their email and a password, tick Auto Confirm User).
--  2. Change the two values below and run this script.
-- Roles: 'admin' (manages the organisation) or 'member' (works on events).
do $$
declare
  v_email text := 'second.person@example.com';   -- the email of the new person
  v_tenant text := 'Sysconic Technologies';      -- your tenant name, exactly as in the bootstrap script
  v_role text := 'member';
  t uuid; u uuid;
begin
  select id into t from tenant where name = v_tenant;
  if t is null then raise exception 'Tenant % not found', v_tenant; end if;
  select id into u from app_user where lower(email) = lower(v_email);
  if u is null then insert into app_user (email) values (v_email) returning id into u; end if;
  insert into membership (tenant_id, user_id, role) values (t, u, v_role) on conflict do nothing;
end $$;
