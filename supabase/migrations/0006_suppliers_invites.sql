-- Supplier contact details, invitation links (stored only as a hash), and supplier login resolution.
alter table supplier_org
  add column contact_name text,
  add column contact_email text,
  add column created_at timestamptz not null default now();

alter table invitation
  add column supplier_user_id uuid,
  add column expires_at timestamptz not null default (now() + interval '14 days'),
  add column accepted_at timestamptz,
  add column created_by uuid,
  add column created_at timestamptz not null default now(),
  add constraint invitation_supplier_user_fk foreign key (tenant_id, supplier_user_id) references supplier_user (tenant_id, id);

-- What the invitation page may show to someone holding the link (no login yet).
create function invitation_info(p_token_hash text)
returns table (tenant_name text, supplier_name text, contact_email text, event_ref text, event_title text, expired boolean, accepted boolean)
language sql security definer set search_path = public as $$
  select t.name, s.name, u.email, e.ref, e.title, i.expires_at <= now(), i.accepted_at is not null
    from invitation i
    join tenant t on t.id = i.tenant_id
    join supplier_org s on s.tenant_id = i.tenant_id and s.id = i.supplier_id
    join supplier_user su on su.tenant_id = i.tenant_id and su.id = i.supplier_user_id
    join app_user u on u.id = su.user_id
    join sourcing_event e on e.tenant_id = i.tenant_id and e.id = i.event_id
   where i.token_hash = p_token_hash;
$$;

-- Link a signed-in auth user to the invited supplier user. The link itself proves the invitation; the email must also match.
create function accept_invitation(p_token_hash text, p_auth_user_id uuid, p_email text)
returns table (tenant_id uuid, supplier_id uuid, supplier_user_id uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare inv record; u record;
begin
  select i.* into inv from invitation i where i.token_hash = p_token_hash and i.expires_at > now();
  if not found then return; end if;
  select a.* into u from supplier_user su join app_user a on a.id = su.user_id where su.tenant_id = inv.tenant_id and su.id = inv.supplier_user_id;
  if not found or lower(u.email) <> lower(p_email) then return; end if;
  if u.auth_user_id is null then
    if exists (select 1 from app_user x where x.auth_user_id = p_auth_user_id) then return; end if;
    update app_user set auth_user_id = p_auth_user_id where id = u.id;
  elsif u.auth_user_id <> p_auth_user_id then
    return;
  end if;
  update invitation set accepted_at = coalesce(accepted_at, now()) where tenant_id = inv.tenant_id and id = inv.id;
  return query select inv.tenant_id, inv.supplier_id, inv.supplier_user_id;
end $$;

create function resolve_supplier_login(p_auth_user_id uuid)
returns table (tenant_id uuid, tenant_name text, supplier_id uuid, supplier_name text, supplier_user_id uuid, email text)
language sql security definer set search_path = public as $$
  select su.tenant_id, t.name, su.supplier_id, s.name, su.id, u.email
    from app_user u
    join supplier_user su on su.user_id = u.id
    join tenant t on t.id = su.tenant_id
    join supplier_org s on s.tenant_id = su.tenant_id and s.id = su.supplier_id
   where u.auth_user_id = p_auth_user_id
   order by t.name, s.name;
$$;

revoke all on function invitation_info(text), accept_invitation(text, uuid, text), resolve_supplier_login(uuid) from public;
grant execute on function invitation_info(text), accept_invitation(text, uuid, text), resolve_supplier_login(uuid) to app_runtime;
