-- Lots: an event can be split into lots that are priced, ranked and awarded separately.
create table event_lot (
  tenant_id uuid not null references tenant(id),
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  lot_no int not null check (lot_no > 0),
  name text not null check (length(btrim(name)) between 1 and 120),
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  unique (tenant_id, event_id, lot_no)
);
alter table event_lot enable row level security;
alter table event_lot force row level security;
create policy tenant_isolation on event_lot using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update, delete on event_lot to app_runtime;
-- same rule as items: lots can only change while the event is a draft
create trigger event_lot_draft_only before insert or update or delete on event_lot
  for each row execute function check_event_item_draft();

alter table event_item add column lot_id uuid;
alter table event_item add constraint event_item_lot_fk foreign key (tenant_id, lot_id) references event_lot (tenant_id, id);

alter table recommendation add column lot_id uuid;
alter table recommendation add constraint recommendation_lot_fk foreign key (tenant_id, lot_id) references event_lot (tenant_id, id);

alter table handover_log add column supplier_id uuid;
