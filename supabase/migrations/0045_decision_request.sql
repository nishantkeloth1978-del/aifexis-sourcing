-- Release 1 (R1-3): two-person decisions.
-- Opening sealed envelopes (witness), cancelling an event, starting a final round and reopening for amendment
-- need a second person. Naming that person is no longer enough: they must sign in and confirm the exact request.
create table decision_request (
  tenant_id     uuid not null references tenant(id),
  id            uuid not null default gen_random_uuid(),
  event_id      uuid not null,
  command       text not null check (command in ('OpenEnvelope1', 'OpenEnvelope2', 'CancelEvent', 'StartFinalRound', 'ReopenForAmendment')),
  state_version int  not null,                       -- the request is valid only for this exact state of the event
  payload       jsonb not null default '{}'::jsonb,
  payload_hash  text not null,
  requested_by  uuid not null,
  designated    uuid not null,                       -- the witness or approver who must confirm
  status        text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'cancelled', 'executed')),
  expires_at    timestamptz not null default now() + interval '24 hours',
  decided_by    uuid,
  decided_at    timestamptz,
  executed_at   timestamptz,
  created_at    timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, requested_by) references membership (tenant_id, id),
  foreign key (tenant_id, designated) references membership (tenant_id, id),
  check (requested_by <> designated),
  check (decided_by is null or (decided_by = designated and decided_by <> requested_by))
);
-- One open request per person, event and command; a new request replaces the old one.
create unique index decision_request_open on decision_request (tenant_id, event_id, command, requested_by) where status in ('pending', 'confirmed');
create index decision_request_inbox on decision_request (tenant_id, designated) where status = 'pending';

alter table decision_request enable row level security; alter table decision_request force row level security;
create policy tenant_isolation on decision_request using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update on decision_request to app_runtime;

select close_api_grants();
