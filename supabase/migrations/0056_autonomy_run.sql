-- One row per company: when the automatic steps last ran, what they did, and a short lease so two runners (the internal worker and the
-- daily scheduler) never work on the same company at once. The lease is a timestamp, so it also works through a pooled database connection.
create table autonomy_run (
  tenant_id    uuid primary key references tenant(id),
  last_run_at  timestamptz,
  last_source  text check (last_source in ('worker', 'cron')),
  last_report  jsonb,
  runs         bigint not null default 0,
  locked_until timestamptz
);
alter table autonomy_run enable row level security; alter table autonomy_run force row level security;
create policy tenant_isolation on autonomy_run using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update on autonomy_run to app_runtime;

select close_api_grants();
