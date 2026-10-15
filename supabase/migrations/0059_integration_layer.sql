-- Autonomous sourcing, phase 3: integration layer v1.
-- integration_client: a system (ERP, iPaaS, script) that may send requests in and receive signed webhooks out. Keys are stored hashed, shown once.
-- integration_idempotency: a repeated POST with the same Idempotency-Key returns the first result.
-- webhook_delivery: the outbound queue and its log (retries, replay).
create table integration_client (
  tenant_id     uuid not null references tenant(id),
  id            uuid not null default gen_random_uuid(),
  name          text not null check (length(name) between 2 and 80),
  key_prefix    text not null check (key_prefix ~ '^[a-f0-9]{12}$'),
  key_hash      text not null check (length(key_hash) = 64),
  scopes        text[] not null default '{requests:write,requests:read}',
  owner_membership_id uuid not null,
  webhook_url   text check (webhook_url is null or (length(webhook_url) <= 500 and webhook_url like 'https://%')),
  webhook_secret_enc text,
  webhook_events text[] not null default '{}',
  active        boolean not null default true,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, owner_membership_id) references membership (tenant_id, id)
);
create unique index integration_client_prefix on integration_client (key_prefix);

create table integration_idempotency (
  tenant_id   uuid not null references tenant(id),
  client_id   uuid not null,
  idem_key    text not null check (length(idem_key) between 1 and 100),
  request_id  uuid,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, client_id, idem_key),
  foreign key (tenant_id, client_id) references integration_client (tenant_id, id)
);

create table webhook_delivery (
  tenant_id   uuid not null references tenant(id),
  id          bigint generated always as identity,
  client_id   uuid not null,
  event_type  text not null check (length(event_type) between 3 and 60),
  payload     jsonb not null,
  state       text not null default 'pending' check (state in ('pending', 'delivered', 'dead')),
  attempts    int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status int,
  last_error  text check (last_error is null or length(last_error) <= 300),
  created_at  timestamptz not null default now(),
  delivered_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, client_id) references integration_client (tenant_id, id)
);
create index webhook_delivery_due on webhook_delivery (tenant_id, next_attempt_at) where state = 'pending';

do $$ declare t text; begin
  foreach t in array array['integration_client', 'integration_idempotency', 'webhook_delivery'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())', t);
    execute format('grant select, insert, update on %I to app_runtime', t);
  end loop;
end $$;

-- A failed attempt gives its key back, so a corrected retry is not mistaken for a repeat.
grant delete on integration_idempotency to app_runtime;

-- The one thing that must work before a company is known: finding the client behind a key. Returns the stored hash only; the caller compares.
create or replace function integration_lookup(p_prefix text)
returns table (tenant_id uuid, id uuid, key_hash text, scopes text[], owner_membership_id uuid, active boolean)
language sql security definer set search_path = public as $$
  select c.tenant_id, c.id, c.key_hash, c.scopes, c.owner_membership_id, (c.active and c.revoked_at is null)
    from integration_client c where c.key_prefix = p_prefix;
$$;
revoke all on function integration_lookup(text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'app_runtime') then grant execute on function integration_lookup(text) to app_runtime; end if;
end $$;

select close_api_grants();
