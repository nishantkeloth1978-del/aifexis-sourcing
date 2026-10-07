-- The buyer's recommendation for an event (data class D14). One per event; a rejected award lets the buyer record a new one.
create table recommendation (
  tenant_id uuid not null references tenant(id),
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  supplier_id uuid not null,
  note text not null check (length(btrim(note)) between 10 and 4000),
  calculation_run_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id),
  foreign key (tenant_id, created_by) references membership (tenant_id, id)
);
alter table recommendation enable row level security;
alter table recommendation force row level security;
create policy tenant_isolation on recommendation using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert on recommendation to app_runtime;
create trigger recommendation_immutable before update or delete on recommendation for each row execute function forbid_change();
