-- In-app assistant: a record of what was asked and answered, kept per company so an administrator can review it.
-- Holds the question, the answer, which lookups ran and the page. No keys, no passwords; the assistant is told never to take them.
create table assistant_message (
  tenant_id     uuid not null references tenant(id),
  id            uuid not null default gen_random_uuid(),
  membership_id uuid not null,
  page          text not null default '',
  question      text not null,
  answer        text not null,
  looked        text[] not null default '{}',
  ms            int  not null default 0,
  created_at    timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, membership_id) references membership (tenant_id, id)
);
create index assistant_message_recent on assistant_message (tenant_id, created_at desc);

alter table assistant_message enable row level security; alter table assistant_message force row level security;
create policy tenant_isolation on assistant_message using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert on assistant_message to app_runtime;

select close_api_grants();
