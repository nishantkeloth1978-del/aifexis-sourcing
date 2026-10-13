-- Release 1 (R1-1): organisation roles built from a permission catalogue.
-- Each organisation can edit what its built-in roles may do and create its own roles. The administrator role is fixed in code.
-- Event-level roles (buyer, evaluators, approvers, witness, auditor) and sealed-envelope rules are NOT affected by these permissions.
create table org_role (
  tenant_id   uuid not null references tenant(id),
  id          uuid not null default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 60),
  description text check (description is null or length(description) <= 300),
  base_role   text not null check (base_role in ('member', 'integration_admin')),   -- decides data-class access in the authorization layer
  system_key  text check (system_key in ('member', 'integration_admin')),            -- set for the organisation's copy of a built-in role
  version     int  not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, id)
);
create unique index org_role_name on org_role (tenant_id, lower(btrim(name)));
create unique index org_role_system_key on org_role (tenant_id, system_key) where system_key is not null;

create table org_role_permission (
  tenant_id  uuid not null,
  role_id    uuid not null,
  permission text not null check (permission ~ '^[a-z_]+\.[a-z_]+$'),
  primary key (tenant_id, role_id, permission),
  foreign key (tenant_id, role_id) references org_role (tenant_id, id) on delete cascade
);

alter table membership add column org_role_id uuid;
alter table membership add constraint membership_org_role_fk foreign key (tenant_id, org_role_id) references org_role (tenant_id, id);

alter table org_role enable row level security;            alter table org_role force row level security;
alter table org_role_permission enable row level security; alter table org_role_permission force row level security;
create policy tenant_isolation on org_role            using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
create policy tenant_isolation on org_role_permission using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update, delete on org_role, org_role_permission to app_runtime;
grant update (org_role_id) on membership to app_runtime;

select close_api_grants();
