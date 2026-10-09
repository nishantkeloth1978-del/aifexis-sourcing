-- Evaluation assumptions: extra costs the buyer adds to each qualified bid before comparing (freight, duty, installation, a percentage uplift).
create table tco_assumption (
  tenant_id  uuid not null,
  id         uuid not null default gen_random_uuid(),
  event_id   uuid not null,
  label      text not null check (length(btrim(label)) between 2 and 80),
  kind       text not null check (kind in ('pct', 'amount')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  unique (tenant_id, event_id, label)
);
create table tco_value (
  tenant_id     uuid not null,
  assumption_id uuid not null,
  supplier_id   uuid not null,
  value         numeric(18, 4) not null check (value >= 0),
  set_by        uuid not null,
  set_at        timestamptz not null default now(),
  primary key (tenant_id, assumption_id, supplier_id),
  foreign key (tenant_id, assumption_id) references tco_assumption (tenant_id, id) on delete cascade,
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id)
);
do $$ declare t text; begin
  foreach t in array array['tco_assumption', 'tco_value'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())', t);
    execute format('grant select, insert, update, delete on %I to app_runtime', t);
  end loop;
end $$;
