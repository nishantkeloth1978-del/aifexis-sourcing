-- Autonomous sourcing, phase 8b: the company's Ariba (cXML purchase order) mapping.
-- The buyer's Ariba Network ID and name go in the cXML header; the unit map turns our units into UN/CEFACT codes.
create table ariba_mapping (
  tenant_id        uuid primary key references tenant(id),
  buyer_network_id text not null check (buyer_network_id ~ '^[A-Za-z0-9._-]{3,40}$'),
  buyer_name       text not null check (length(btrim(buyer_name)) between 2 and 100),
  ship_to_name     text check (ship_to_name is null or length(btrim(ship_to_name)) between 2 and 100),
  test_mode        boolean not null default true,
  uom_map          jsonb not null default '{}' check (jsonb_typeof(uom_map) = 'object'),
  updated_by       uuid,
  updated_at       timestamptz not null default now()
);
alter table ariba_mapping enable row level security;
alter table ariba_mapping force row level security;
create policy tenant_isolation on ariba_mapping using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update on ariba_mapping to app_runtime;
select close_api_grants();
