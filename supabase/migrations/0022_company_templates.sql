-- Company-owned templates (cloned or imported). They live beside the platform catalogue but are visible to their own tenant only.
create table company_template (
  tenant_id     uuid not null references tenant(id),
  key           text not null check (key ~ '^CO_[A-Z0-9_]{1,60}$'),
  category_code text not null references purchase_category(code),
  event_type    text not null check (event_type in ('RFI', 'RFQ', 'RFP')),
  method        text not null default 'invited' check (method in ('open', 'invited', 'framework', 'single_source')),
  pricing_model text not null check (pricing_model in ('itemized', 'person_day', 'manpower', 'subscription', 'milestone', 'freight', 'mixed', 'none')),
  title_en      text not null check (length(title_en) between 1 and 160),
  title_ar      text not null check (length(title_ar) between 1 and 160),
  summary_en    text not null default '' check (length(summary_en) <= 500),
  summary_ar    text not null default '' check (length(summary_ar) <= 500),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  primary key (tenant_id, key)
);
create table company_template_version (
  tenant_id     uuid not null,
  template_key  text not null,
  version       int  not null check (version >= 1),
  content       jsonb not null check (pg_column_size(content) < 262144),
  content_hash  text not null,
  requires      text[] not null default '{}',
  change_note   text not null default '',
  created_at    timestamptz not null default now(),
  primary key (tenant_id, template_key, version),
  foreign key (tenant_id, template_key) references company_template (tenant_id, key)
);
create function company_template_version_guard() returns trigger language plpgsql as $$
begin raise exception 'company template versions cannot be changed or deleted'; end $$;
create trigger company_template_version_guard before update or delete on company_template_version for each row execute function company_template_version_guard();

do $$ declare t text; begin
  foreach t in array array['company_template', 'company_template_version'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())', t);
  end loop;
end $$;
grant select, insert on company_template, company_template_version to app_runtime;

-- One catalogue for the application: platform templates plus this tenant's own.
create view template_catalog as
  select key, kind, pack_code, category_code, event_type, method, pricing_model, title_en, title_ar, summary_en, summary_ar from template_definition
  union all
  select key, 'scenario', null, category_code, event_type, method, pricing_model, title_en, title_ar, summary_en, summary_ar from company_template where tenant_id = current_tenant();
create view template_catalog_versions as
  select template_key, version, status, content, content_hash, requires, change_note, published_at from template_version_published
  union all
  select template_key, version, 'published', content, content_hash, requires, change_note, created_at from company_template_version where tenant_id = current_tenant();
grant select on template_catalog, template_catalog_versions to app_runtime;

-- A company template key is not in the platform table, so these links are checked by the application instead.
do $$ declare r record; begin
  for r in select c.conrelid::regclass as tbl, c.conname from pg_constraint c where c.contype = 'f' and c.confrelid in ('template_definition'::regclass, 'template_version'::regclass) and c.conrelid::regclass::text in ('company_pack_assignment', 'company_override', 'sourcing_event') loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;
