-- Event reference numbers, owner department, creator and creation time.
alter table sourcing_event
  add column ref text,
  add column owner_dept text,
  add column currency text not null default 'AED',
  add column created_at timestamptz not null default now(),
  add column created_by uuid,
  add constraint sourcing_event_ref_unique unique (tenant_id, ref),
  add constraint sourcing_event_creator_fk foreign key (tenant_id, created_by) references membership (tenant_id, id);

-- One counter per tenant and year so references (EV-2026-001) are gap-free per tenant and race-safe.
create table event_counter (
  tenant_id uuid not null references tenant(id),
  year int not null,
  last int not null default 0,
  primary key (tenant_id, year)
);
alter table event_counter enable row level security;
alter table event_counter force row level security;
create policy tenant_isolation on event_counter using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update, delete on event_counter to app_runtime;
