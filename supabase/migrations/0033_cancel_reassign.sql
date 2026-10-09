-- Cancelling an event after it was submitted, and replacing a technical evaluator mid-evaluation.
alter table sourcing_event add column cancel_reason text, add column cancelled_at timestamptz;

create table evaluator_reassignment (
  tenant_id       uuid not null,
  id              uuid not null default gen_random_uuid(),
  event_id        uuid not null,
  from_membership uuid not null,
  to_membership   uuid not null,
  reason          text not null check (length(btrim(reason)) between 5 and 1000),
  by_membership   uuid not null,
  at              timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, from_membership) references membership (tenant_id, id),
  foreign key (tenant_id, to_membership) references membership (tenant_id, id)
);
alter table evaluator_reassignment enable row level security;
alter table evaluator_reassignment force row level security;
create policy tenant_isolation on evaluator_reassignment using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert on evaluator_reassignment to app_runtime;
