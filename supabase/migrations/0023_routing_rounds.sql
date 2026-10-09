-- Approver routing (named owner and deputy per approval step) and final (best-and-final) rounds.
create table approver_route (
  tenant_id            uuid not null references tenant(id),
  id                   uuid not null default gen_random_uuid(),
  step                 text not null check (step in ('publication', 'technical', 'award')),
  slot                 int  not null default 1 check (slot between 1 and 5),
  owner_membership_id  uuid not null,
  deputy_membership_id uuid,
  away_from            date,
  away_to              date,
  updated_at           timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, step, slot),
  check (deputy_membership_id is null or deputy_membership_id <> owner_membership_id),
  check ((away_from is null) = (away_to is null)),
  check (away_to is null or away_to >= away_from),
  foreign key (tenant_id, owner_membership_id) references membership (tenant_id, id),
  foreign key (tenant_id, deputy_membership_id) references membership (tenant_id, id)
);

alter table sourcing_event add column round_no int not null default 1;

create table event_round (
  tenant_id           uuid not null,
  event_id            uuid not null,
  round_no            int  not null check (round_no >= 2),
  reason              text not null default '' check (length(reason) <= 1000),
  started_by          uuid,
  approved_by         uuid,
  previous_closes_at  timestamptz,
  new_closes_at       timestamptz not null,
  shortlist           uuid[] not null check (cardinality(shortlist) >= 1),
  created_at          timestamptz not null default now(),
  primary key (tenant_id, event_id, round_no),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id)
);

do $$ declare t text; begin
  foreach t in array array['approver_route', 'event_round'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())', t);
  end loop;
end $$;
grant select, insert, update, delete on approver_route to app_runtime;
grant select, insert on event_round to app_runtime;
