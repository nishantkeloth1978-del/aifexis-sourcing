-- Autonomous sourcing, phase 2: purchase and service requests. A need raised in the app (or later arriving from another system) that a buyer
-- turns into a draft event, rejects with a reason, or the requester withdraws.
create table request_counter (
  tenant_id uuid not null references tenant(id),
  year      int  not null,
  last      int  not null,
  primary key (tenant_id, year)
);
create table purchase_request (
  tenant_id     uuid not null references tenant(id),
  id            uuid not null default gen_random_uuid(),
  ref           text not null,
  source        text not null default 'app' check (source in ('app', 'api', 'file', 'email', 'schedule', 'brief')),
  external_ref  text check (external_ref is null or length(external_ref) between 1 and 100),
  requester_membership_id uuid not null,
  kind          text not null check (kind in ('goods', 'service')),
  title         text not null check (length(title) between 3 and 200),
  description   text not null default '' check (length(description) <= 4000),
  owner_dept    text not null default '' check (length(owner_dept) <= 100),
  needed_by     date,
  est_value     numeric(18, 2) check (est_value is null or est_value >= 0),
  currency      text not null default 'AED' check (currency ~ '^[A-Z]{3}$'),
  lines         jsonb not null default '[]' check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 50),
  state         text not null default 'new' check (state in ('new', 'converted', 'rejected', 'withdrawn')),
  decision_note text not null default '' check (length(decision_note) <= 1000),
  event_id      uuid,
  decided_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, ref),
  foreign key (tenant_id, requester_membership_id) references membership (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id)
);
create unique index purchase_request_external on purchase_request (tenant_id, source, external_ref) where external_ref is not null;
create index purchase_request_state on purchase_request (tenant_id, state, created_at desc);

alter table sourcing_event add column request_id uuid;
alter table sourcing_event add foreign key (tenant_id, request_id) references purchase_request (tenant_id, id);

do $$ declare t text; begin
  foreach t in array array['request_counter', 'purchase_request'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())', t);
    execute format('grant select, insert, update on %I to app_runtime', t);
  end loop;
end $$;

select close_api_grants();
