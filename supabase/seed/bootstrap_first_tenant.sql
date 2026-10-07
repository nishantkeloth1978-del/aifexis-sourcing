-- Run once in the Supabase SQL editor AFTER creating your login under Authentication > Users.
-- Change the two values below, then run the whole script.
do $$
declare
  v_email text := 'nishant.keloth@gmail.com';   -- the email you use to sign in
  v_tenant text := 'Sysconic Technologies';     -- tenant (company) name
  t uuid; u uuid;
begin
  select id into t from tenant where name = v_tenant;
  if t is null then insert into tenant (name) values (v_tenant) returning id into t; end if;
  select id into u from app_user where lower(email) = lower(v_email);
  if u is null then insert into app_user (email) values (v_email) returning id into u; end if;
  insert into membership (tenant_id, user_id, role) values (t, u, 'admin') on conflict do nothing;
end $$;
