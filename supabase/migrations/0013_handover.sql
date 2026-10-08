-- Record of every handover of an awarded event to an ERP / procurement system.
create table handover_log (
  tenant_id uuid not null references tenant(id),
  id bigint generated always as identity,
  event_id uuid not null,
  target text not null check (target in ('SAP', 'ARIBA')),
  mode text not null default 'mock' check (mode in ('mock', 'live')),
  status text not null check (status in ('sent', 'failed')),
  reference text,
  payload jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id)
);
create index handover_log_event_idx on handover_log (tenant_id, event_id, id desc);
alter table handover_log enable row level security;
alter table handover_log force row level security;
create policy tenant_isolation on handover_log using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert on handover_log to app_runtime;
