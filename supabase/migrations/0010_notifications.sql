-- In-app notifications. One row per recipient; read_at is set when the person marks them read.
create table notification (
  tenant_id uuid not null references tenant(id),
  id bigint generated always as identity,
  user_id uuid not null references app_user(id),
  event_id uuid,
  kind text not null,
  message text not null check (length(message) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (tenant_id, id)
);
create index notification_user_idx on notification (tenant_id, user_id, created_at desc);
alter table notification enable row level security;
alter table notification force row level security;
create policy tenant_isolation on notification using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update on notification to app_runtime;
