-- Autonomous sourcing, phase 0 and 1: one policy per company that controls the automatic steps (reminders, one capped deadline extension,
-- approver nudges) and a pause switch. Defaults reproduce today's behaviour: one reminder 24 hours before closing, nothing else.
create table autonomy_policy (
  tenant_id      uuid primary key references tenant(id),
  paused         boolean not null default false,
  reminder_days  int[] not null default '{1}'
                 check (cardinality(reminder_days) between 0 and 4 and reminder_days <@ array[1,2,3,4,5,6,7,10,14]),
  extend_enabled boolean not null default false,
  extend_hours   int not null default 48 check (extend_hours between 1 and 168),
  extend_min_bids int not null default 1 check (extend_min_bids between 1 and 50),
  nudge_hours    int not null default 48 check (nudge_hours between 0 and 336),
  updated_by     uuid,
  updated_at     timestamptz not null default now()
);
alter table autonomy_policy enable row level security; alter table autonomy_policy force row level security;
create policy tenant_isolation on autonomy_policy using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update on autonomy_policy to app_runtime;

-- An event is extended automatically at most once.
alter table sourcing_event add column auto_extended_at timestamptz;

select close_api_grants();
