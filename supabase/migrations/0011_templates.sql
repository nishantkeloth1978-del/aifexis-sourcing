-- Event templates: a reusable set of lines (and department) that a new event can start from.
create table event_template (
  tenant_id uuid not null references tenant(id),
  id uuid not null default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  owner_dept text,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id)
);
alter table event_template enable row level security;
alter table event_template force row level security;
create policy tenant_isolation on event_template using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, delete on event_template to app_runtime;
