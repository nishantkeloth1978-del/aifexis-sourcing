-- In-app assistant, stage 3: changes the assistant PREPARES and a person CONFIRMS. A row is a proposal; nothing runs until the same person presses Confirm.
-- A proposal is single-use, expires after 15 minutes, and is bound to the membership that was asked. Params hold only what the screen showed (no keys, no passwords).
create table assistant_action (
  tenant_id     uuid not null references tenant(id),
  id            uuid not null default gen_random_uuid(),
  membership_id uuid not null,
  kind          text not null check (kind in ('create_event','update_event','duplicate_event','add_item')),
  params        jsonb not null,
  summary       jsonb not null,
  status        text not null default 'proposed' check (status in ('proposed','running','done','failed','cancelled')),
  result        text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, membership_id) references membership (tenant_id, id)
);
create index assistant_action_recent on assistant_action (tenant_id, created_at desc);

alter table assistant_action enable row level security; alter table assistant_action force row level security;
create policy tenant_isolation on assistant_action using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update on assistant_action to app_runtime;

select close_api_grants();
