-- Link Supabase Auth users to application users and resolve a login to tenant, user and role.
alter table app_user add column auth_user_id uuid unique;

-- Called by the server after a verified login. Returns one row per tenant membership.
-- First login links the auth user to the app_user with the same email (the email must be confirmed by Supabase).
create function resolve_login(p_auth_user_id uuid, p_email text)
returns table (tenant_id uuid, tenant_name text, user_id uuid, membership_id uuid, role text)
language plpgsql security definer set search_path = public as $$
begin
  update app_user set auth_user_id = p_auth_user_id
   where lower(email) = lower(p_email) and auth_user_id is null
     and not exists (select 1 from app_user x where x.auth_user_id = p_auth_user_id);
  return query
    select m.tenant_id, t.name, u.id, m.id, m.role
      from app_user u
      join membership m on m.user_id = u.id
      join tenant t on t.id = m.tenant_id
     where u.auth_user_id = p_auth_user_id
     order by t.name, m.role;
end $$;

revoke all on function resolve_login(uuid, text) from public;
grant execute on function resolve_login(uuid, text) to app_runtime;
