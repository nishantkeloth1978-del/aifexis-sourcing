-- Optional second-person approval before a company template version can be used.
create table company_template_policy (
  tenant_id         uuid primary key references tenant(id),
  approval_required boolean not null default false,
  updated_by        uuid,
  updated_at        timestamptz not null default now()
);
create table company_template_approval (
  tenant_id     uuid not null references tenant(id),
  template_key  text not null,
  version       int  not null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by  uuid not null,
  submitted_at  timestamptz not null default now(),
  decided_by    uuid,
  decided_at    timestamptz,
  note          text not null default '' check (length(note) <= 500),
  primary key (tenant_id, template_key, version),
  foreign key (tenant_id, template_key, version) references company_template_version (tenant_id, template_key, version),
  check ((status = 'pending') = (decided_by is null)),
  check (decided_by is null or decided_by <> submitted_by)
);
do $$ declare t text; begin
  foreach t in array array['company_template_policy', 'company_template_approval'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())', t);
  end loop;
end $$;
grant select, insert, update on company_template_policy, company_template_approval to app_runtime;

-- A company version is usable only if nothing is pending or rejected for it.
create or replace view template_catalog_versions as
  select template_key, version, status, content, content_hash, requires, change_note, published_at from template_version_published
  union all
  select v.template_key, v.version,
         case coalesce(a.status, 'approved') when 'approved' then 'published' when 'pending' then 'draft' else 'archived' end,
         v.content, v.content_hash, v.requires, v.change_note, v.created_at
    from company_template_version v
    left join company_template_approval a on a.tenant_id = v.tenant_id and a.template_key = v.template_key and a.version = v.version
   where v.tenant_id = current_tenant();
