-- Autonomous sourcing, phase 4: the agent harness and the event drafter.
-- agent_run: every call to an AI agent, with its validated output, the model and token counts. Proposals only; a person accepts or discards.
create table agent_run (
  tenant_id    uuid not null references tenant(id),
  id           uuid not null default gen_random_uuid(),
  agent        text not null check (agent in ('drafter', 'reader', 'recommender')),
  subject_type text not null check (subject_type in ('request', 'bid', 'event')),
  subject_id   uuid not null,
  state        text not null check (state in ('proposed', 'accepted', 'rejected', 'failed')),
  input_digest text not null check (length(input_digest) = 64),
  output       jsonb,
  error        text check (error is null or length(error) <= 300),
  model        text,
  tokens_in    int not null default 0,
  tokens_out   int not null default 0,
  created_by   uuid,
  decided_by   uuid,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  primary key (tenant_id, id)
);
create index agent_run_subject on agent_run (tenant_id, subject_type, subject_id, created_at desc);
create index agent_run_day on agent_run (tenant_id, created_at);

alter table agent_run enable row level security;
alter table agent_run force row level security;
create policy tenant_isolation on agent_run using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update on agent_run to app_runtime;

alter table autonomy_policy add column agent_daily_limit int not null default 50 check (agent_daily_limit between 1 and 1000);
alter table sourcing_event add column drafted_by_agent boolean not null default false;

select close_api_grants();
