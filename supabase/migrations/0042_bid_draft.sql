-- Release 1 (R1-7): a supplier's unsent work is kept on the server so a refresh, a lost connection or a changed device loses nothing.
-- One draft per supplier per event. It is private to that supplier and is removed when they submit.
create table bid_draft (
  tenant_id     uuid not null,
  event_id      uuid not null,
  supplier_id   uuid not null,
  base_revision int  not null default 0,
  payload       jsonb not null,
  saved_at      timestamptz not null default now(),
  primary key (tenant_id, event_id, supplier_id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  check (pg_column_size(payload) <= 500000)
);
alter table bid_draft enable row level security;
alter table bid_draft force row level security;
create policy tenant_isolation on bid_draft using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update, delete on bid_draft to app_runtime, app_supplier;
