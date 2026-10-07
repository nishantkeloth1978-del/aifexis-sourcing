-- Uploaded documents. Kept in the database (private, per tenant, behind row-level security) so no storage keys are needed yet.
-- stored_object (already present) says whose file it is and which data class it belongs to; this table holds the bytes.
alter table stored_object add column created_at timestamptz not null default now();
alter table stored_object add column created_by uuid;

create table stored_blob (
  tenant_id uuid not null references tenant(id),
  object_id uuid not null,
  filename text not null check (length(btrim(filename)) between 1 and 200),
  mime text not null,
  size_bytes int not null check (size_bytes between 1 and 4194304),
  content bytea not null,
  primary key (tenant_id, object_id),
  foreign key (tenant_id, object_id) references stored_object (tenant_id, id) on delete cascade
);
alter table stored_blob enable row level security;
alter table stored_blob force row level security;
create policy tenant_isolation on stored_blob using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, delete on stored_blob to app_runtime;
