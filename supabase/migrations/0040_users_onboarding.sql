-- Organisation onboarding and user management.
alter table tenant add column created_at timestamptz not null default now(), add column suspended_at timestamptz;
alter table membership add column disabled_at timestamptz, add column title text, add column department text, add column created_at timestamptz not null default now();
alter table membership add constraint membership_title_len check (title is null or length(title) <= 80), add constraint membership_dept_len check (department is null or length(department) <= 80);

-- A pending invitation for a staff member. The link carries a random token; only its hash is stored.
create table staff_invitation (
  tenant_id   uuid not null references tenant(id),
  id          uuid not null default gen_random_uuid(),
  email       text not null,
  role        text not null check (role in ('admin', 'integration_admin', 'member')),
  title       text,
  department  text,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, id)
);
create index staff_invitation_email on staff_invitation (tenant_id, lower(email));
alter table staff_invitation enable row level security;
alter table staff_invitation force row level security;
create policy tenant_isolation on staff_invitation using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update on staff_invitation to app_runtime;
grant update (disabled_at, title, department, role) on membership to app_runtime;

-- Sign-in: disabled members and suspended organisations resolve to nothing.
create or replace function resolve_login(p_auth_user_id uuid, p_email text)
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
     where u.auth_user_id = p_auth_user_id and m.disabled_at is null and t.suspended_at is null
     order by t.name, m.role;
end $$;

create or replace function resolve_supplier_login(p_auth_user_id uuid)
returns table (tenant_id uuid, tenant_name text, supplier_id uuid, supplier_name text, supplier_user_id uuid, email text)
language sql security definer set search_path = public as $$
  select su.tenant_id, t.name, su.supplier_id, s.name, su.id, u.email
    from app_user u
    join supplier_user su on su.user_id = u.id
    join tenant t on t.id = su.tenant_id
    join supplier_org s on s.tenant_id = su.tenant_id and s.id = su.supplier_id
   where u.auth_user_id = p_auth_user_id and t.suspended_at is null
   order by t.name, s.name;
$$;

-- What an invitation link shows before anyone signs in.
create or replace function staff_invitation_info(p_token_hash text)
returns table (tenant_name text, email text, role text, expired boolean)
language sql stable security definer set search_path = public as $$
  select t.name, i.email, i.role, (i.expires_at <= now() or i.accepted_at is not null or i.revoked_at is not null or t.suspended_at is not null)
    from staff_invitation i join tenant t on t.id = i.tenant_id where i.token_hash = p_token_hash;
$$;

-- Accepting: the signed-in identity must carry the invited e-mail address. Creates the person and the membership, links the sign-in.
create or replace function accept_staff_invitation(p_token_hash text, p_auth_user_id uuid, p_email text)
returns table (tenant_id uuid, membership_id uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare inv record; u uuid; a uuid; m uuid;
begin
  select i.* into inv from staff_invitation i join tenant t on t.id = i.tenant_id
   where i.token_hash = p_token_hash and i.expires_at > now() and i.accepted_at is null and i.revoked_at is null and t.suspended_at is null;
  if not found or lower(inv.email) <> lower(p_email) then return; end if;
  select id, auth_user_id into u, a from app_user where lower(email) = lower(inv.email);
  if u is null then
    if exists (select 1 from app_user x where x.auth_user_id = p_auth_user_id) then return; end if;
    insert into app_user (email, auth_user_id) values (inv.email, p_auth_user_id) returning id into u;
  elsif a is null then
    if exists (select 1 from app_user x where x.auth_user_id = p_auth_user_id) then return; end if;
    update app_user set auth_user_id = p_auth_user_id where id = u;
  elsif a <> p_auth_user_id then
    return;
  end if;
  insert into membership (tenant_id, user_id, role, title, department) values (inv.tenant_id, u, inv.role, inv.title, inv.department)
    on conflict (tenant_id, user_id, role) do update set disabled_at = null returning id into m;
  update staff_invitation set accepted_at = now() where tenant_id = inv.tenant_id and id = inv.id;
  return query select inv.tenant_id, m;
end $$;

-- Platform owner functions. Called only after the application has checked the platform-owner allow-list.
create or replace function platform_list_tenants()
returns table (id uuid, name text, created_at timestamptz, suspended_at timestamptz, members bigint, admins bigint, events bigint, suppliers bigint)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.created_at, t.suspended_at,
         (select count(*) from membership m where m.tenant_id = t.id and m.disabled_at is null),
         (select count(*) from membership m where m.tenant_id = t.id and m.disabled_at is null and m.role = 'admin'),
         (select count(*) from sourcing_event e where e.tenant_id = t.id and e.deleted_at is null),
         (select count(*) from supplier_org s where s.tenant_id = t.id)
    from tenant t order by t.created_at desc;
$$;

create or replace function platform_create_tenant(p_name text, p_admin_email text, p_token_hash text, p_expires timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if length(btrim(p_name)) < 2 or length(p_name) > 120 then raise exception 'bad name'; end if;
  if exists (select 1 from tenant where lower(name) = lower(btrim(p_name))) then raise exception 'name taken'; end if;
  insert into tenant (name) values (btrim(p_name)) returning id into t;
  insert into staff_invitation (tenant_id, email, role, token_hash, expires_at) values (t, lower(btrim(p_admin_email)), 'admin', p_token_hash, p_expires);
  return t;
end $$;

create or replace function platform_invite_admin(p_tenant uuid, p_admin_email text, p_token_hash text, p_expires timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from tenant where id = p_tenant) then return false; end if;
  update staff_invitation set revoked_at = now() where tenant_id = p_tenant and lower(email) = lower(btrim(p_admin_email)) and accepted_at is null and revoked_at is null;
  insert into staff_invitation (tenant_id, email, role, token_hash, expires_at) values (p_tenant, lower(btrim(p_admin_email)), 'admin', p_token_hash, p_expires);
  return true;
end $$;

create or replace function platform_set_suspended(p_tenant uuid, p_suspended boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update tenant set suspended_at = case when p_suspended then coalesce(suspended_at, now()) else null end where id = p_tenant;
  return found;
end $$;

revoke all on function staff_invitation_info(text), accept_staff_invitation(text, uuid, text), platform_list_tenants(),
  platform_create_tenant(text, text, text, timestamptz), platform_invite_admin(uuid, text, text, timestamptz), platform_set_suspended(uuid, boolean) from public;
grant execute on function staff_invitation_info(text), accept_staff_invitation(text, uuid, text), platform_list_tenants(),
  platform_create_tenant(text, text, text, timestamptz), platform_invite_admin(uuid, text, text, timestamptz), platform_set_suspended(uuid, boolean) to app_runtime;
