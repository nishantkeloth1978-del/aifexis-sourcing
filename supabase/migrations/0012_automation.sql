-- Outgoing e-mail queue and a log of reminders already sent.
create table email_outbox (
  tenant_id uuid not null references tenant(id),
  id bigint generated always as identity,
  event_id uuid,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'logged', 'failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (tenant_id, id)
);
create index email_outbox_pending_idx on email_outbox (tenant_id, id) where status = 'pending';
alter table email_outbox enable row level security;
alter table email_outbox force row level security;
create policy tenant_isolation on email_outbox using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update on email_outbox to app_runtime;

create table reminder_log (
  tenant_id uuid not null references tenant(id),
  event_id uuid not null,
  supplier_id uuid not null,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (tenant_id, event_id, supplier_id, kind)
);
alter table reminder_log enable row level security;
alter table reminder_log force row level security;
create policy tenant_isolation on reminder_log using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert on reminder_log to app_runtime;
