-- Supplier master data, item catalogue, and item codes on event lines.
alter table supplier_org
  add column vendor_code text check (vendor_code is null or length(btrim(vendor_code)) between 1 and 40),
  add column country     text check (country is null or length(country) <= 80),
  add column category    text check (category is null or length(category) <= 120),
  add column phone       text check (phone is null or length(phone) <= 40),
  add column tax_no      text check (tax_no is null or length(tax_no) <= 60),
  add column notes       text check (notes is null or length(notes) <= 1000),
  add column status      text not null default 'active' check (status in ('active', 'blocked')),
  add column updated_at  timestamptz not null default now();
create unique index supplier_org_vendor_code on supplier_org (tenant_id, lower(vendor_code)) where vendor_code is not null;

create table catalog_item (
  tenant_id   uuid not null references tenant(id),
  id          uuid not null default gen_random_uuid(),
  code        text not null check (length(btrim(code)) between 1 and 40),
  description text not null check (length(btrim(description)) between 1 and 500),
  unit        text not null check (length(btrim(unit)) between 1 and 20),
  category    text check (category is null or length(category) <= 120),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, id)
);
create unique index catalog_item_code on catalog_item (tenant_id, upper(code));
alter table catalog_item enable row level security;
alter table catalog_item force row level security;
create policy tenant_isolation on catalog_item using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update, delete on catalog_item to app_runtime;

alter table event_item add column item_code text check (item_code is null or length(btrim(item_code)) between 1 and 40);
