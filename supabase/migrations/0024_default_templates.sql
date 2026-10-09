-- A company's chosen default template per event type, optionally narrowed to a purchase category ('*' = any category).
create table company_default_template (
  tenant_id     uuid not null references tenant(id),
  event_type    text not null check (event_type in ('RFI', 'RFQ', 'RFP')),
  category_code text not null default '*',
  template_key  text not null check (length(template_key) between 1 and 80),
  set_by        uuid,
  set_at        timestamptz not null default now(),
  primary key (tenant_id, event_type, category_code)
);
alter table company_default_template enable row level security;
alter table company_default_template force row level security;
create policy tenant_isolation on company_default_template using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update, delete on company_default_template to app_runtime;
