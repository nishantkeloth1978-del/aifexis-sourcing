-- Vendor portal: suppliers chosen on a draft event are invited when it is published; suppliers confirm or decline an invitation;
-- new vendors register themselves on a public page and an administrator approves them.

-- Suppliers picked while the event is still a draft. Their invitations are created at publication.
create table event_supplier_plan (
  tenant_id   uuid not null references tenant(id),
  event_id    uuid not null,
  supplier_id uuid not null,
  added_by    uuid,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, event_id, supplier_id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id)
);

-- A supplier's answer to an invitation. accepted_at (existing) only means "the supplier opened the link and has an account".
alter table invitation
  add column response text check (response is null or response in ('accepted', 'declined')),
  add column responded_at timestamptz,
  add column decline_reason text check (decline_reason is null or length(decline_reason) <= 500),
  add column invite_expires_hours int check (invite_expires_hours is null or invite_expires_hours between 1 and 8760);

-- The public registration link of a company, and the applications it receives.
create table vendor_registration (
  tenant_id uuid primary key references tenant(id),
  reg_key   text not null unique check (reg_key ~ '^[a-f0-9]{32}$'),
  enabled   boolean not null default true,
  created_at timestamptz not null default now()
);
create table supplier_application (
  tenant_id    uuid not null references tenant(id),
  id           uuid not null default gen_random_uuid(),
  company      text not null check (length(company) between 2 and 200),
  contact_name text not null default '' check (length(contact_name) <= 100),
  contact_email text not null check (length(contact_email) between 5 and 200),
  country      text not null default '' check (length(country) <= 100),
  category     text not null default '' check (length(category) <= 100),
  phone        text not null default '' check (length(phone) <= 50),
  tax_no       text not null default '' check (length(tax_no) <= 100),
  notes        text not null default '' check (length(notes) <= 1000),
  state        text not null default 'pending' check (state in ('pending', 'approved', 'rejected')),
  decision_note text not null default '' check (length(decision_note) <= 500),
  supplier_id  uuid,
  decided_by   uuid,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  primary key (tenant_id, id)
);
create unique index supplier_application_pending_email on supplier_application (tenant_id, lower(contact_email)) where state = 'pending';
create index supplier_application_state on supplier_application (tenant_id, state, created_at desc);

do $$ declare t text; begin
  foreach t in array array['event_supplier_plan', 'vendor_registration', 'supplier_application'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())', t);
    execute format('grant select, insert, update, delete on %I to app_runtime', t);
  end loop;
end $$;

-- Public side (no login, no company chosen yet): look up a registration link and submit an application. Nothing else is exposed.
create function vendor_reg_info(p_key text) returns table (tenant_name text)
language sql security definer set search_path = public as $$
  select t.name from vendor_registration r join tenant t on t.id = r.tenant_id where r.reg_key = p_key and r.enabled;
$$;

create function vendor_reg_submit(p_key text, p_company text, p_contact_name text, p_email text, p_country text, p_category text, p_phone text, p_tax_no text, p_notes text)
returns text language plpgsql security definer set search_path = public as $$
declare r record; em text := lower(trim(p_email));
begin
  select * into r from vendor_registration where reg_key = p_key and enabled;
  if not found then return 'closed'; end if;
  if exists (select 1 from supplier_org s where s.tenant_id = r.tenant_id and (lower(s.name) = lower(trim(p_company)) or lower(s.contact_email) = em)) then return 'exists'; end if;
  if exists (select 1 from app_user a join membership m on m.user_id = a.id where lower(a.email) = em and m.tenant_id = r.tenant_id) then return 'staff'; end if;
  if exists (select 1 from supplier_application a where a.tenant_id = r.tenant_id and lower(a.contact_email) = em and a.state = 'pending') then return 'pending'; end if;
  if (select count(*) from supplier_application a where a.tenant_id = r.tenant_id and a.created_at > now() - interval '1 hour') >= 30 then return 'busy'; end if;
  insert into supplier_application (tenant_id, company, contact_name, contact_email, country, category, phone, tax_no, notes)
  values (r.tenant_id, trim(p_company), left(coalesce(trim(p_contact_name), ''), 100), em, left(coalesce(trim(p_country), ''), 100), left(coalesce(trim(p_category), ''), 100),
          left(coalesce(trim(p_phone), ''), 50), left(coalesce(trim(p_tax_no), ''), 100), left(coalesce(trim(p_notes), ''), 1000));
  return 'ok';
end $$;

revoke all on function vendor_reg_info(text), vendor_reg_submit(text, text, text, text, text, text, text, text, text) from public;
grant execute on function vendor_reg_info(text), vendor_reg_submit(text, text, text, text, text, text, text, text, text) to app_runtime;

select close_api_grants();
