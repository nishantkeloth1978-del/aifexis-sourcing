-- A connected system can ask for a draft event to be created as soon as one of its requests arrives (no manual "convert" step).
-- The event is still a draft: it needs the normal publication approval before suppliers see anything.
alter table integration_client add column auto_event boolean not null default false;
select close_api_grants();
