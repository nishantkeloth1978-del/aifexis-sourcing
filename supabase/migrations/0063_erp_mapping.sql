-- Autonomous sourcing, phase 8: the company's SAP purchase-order mapping (organisation codes and unit-of-measure map).
-- The award itself stays in the stable aifexis.award.v1 layout; this only says how it is turned into an SAP purchase order.
create table erp_mapping (
  tenant_id     uuid not null references tenant(id),
  target        text not null check (target = 'SAP'),
  company_code  text not null check (company_code ~ '^[A-Z0-9]{1,4}$'),
  purch_org     text not null check (purch_org ~ '^[A-Z0-9]{1,4}$'),
  purch_group   text not null check (purch_group ~ '^[A-Z0-9]{1,3}$'),
  plant         text check (plant is null or plant ~ '^[A-Z0-9]{1,4}$'),
  doc_type      text not null default 'NB' check (doc_type ~ '^[A-Z0-9]{1,4}$'),
  uom_map       jsonb not null default '{}' check (jsonb_typeof(uom_map) = 'object'),
  updated_by    uuid,
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, target)
);
alter table erp_mapping enable row level security;
alter table erp_mapping force row level security;
create policy tenant_isolation on erp_mapping using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update on erp_mapping to app_runtime;
select close_api_grants();
