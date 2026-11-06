-- Technical evaluation agent: drafted scores per bidder and criterion (a person reviews and saves them as their own scores),
-- a per-event switch for running the agent automatically, and a marker so an automatic run is tried once per event.
create table tech_score_draft (
  tenant_id   uuid not null references tenant(id),
  event_id    uuid not null,
  supplier_id uuid not null,
  criterion   text not null check (length(criterion) between 1 and 200),
  score       numeric(3,1) not null check (score >= 0 and score <= 10),
  assessment  text not null check (assessment in ('meets', 'partly', 'does_not_meet', 'no_evidence')),
  summary     text not null default '' check (length(summary) <= 500),
  quotes      jsonb not null default '[]',
  model       text not null default '',
  run_id      uuid not null,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, event_id, supplier_id, criterion),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id)
);
alter table tech_score_draft enable row level security;
alter table tech_score_draft force row level security;
create policy tenant_isolation on tech_score_draft using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update, delete on tech_score_draft to app_runtime;

alter table sourcing_event add column if not exists ai_tech_eval boolean;            -- null: follow the company setting
alter table sourcing_event add column if not exists ai_agent_tried_at timestamptz;   -- the automatic run was attempted

select close_api_grants();
