-- Autonomous sourcing, phase 5: bid checks. Findings from fixed rules and from the bid reader agent, per bid revision, and what the buyer did about each.
create table bid_check (
  tenant_id    uuid not null references tenant(id),
  id           uuid not null default gen_random_uuid(),
  event_id     uuid not null,
  supplier_id  uuid not null,
  revision_no  int not null,
  source       text not null check (source in ('rule', 'reader')),
  kind         text not null check (kind in ('price_missing', 'currency', 'gate_declined', 'price_outlier', 'exclusion', 'deviation', 'condition', 'alternative', 'missing_info', 'unclear')),
  severity     text not null check (severity in ('info', 'warn', 'block')),
  line_no      int,
  detail       text not null check (length(detail) between 1 and 500),
  quote        text check (quote is null or length(quote) <= 300),
  state        text not null default 'open' check (state in ('open', 'asked', 'resolved', 'dismissed')),
  run_id       uuid,
  created_at   timestamptz not null default now(),
  decided_by   uuid,
  decided_at   timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id)
);
create index bid_check_event on bid_check (tenant_id, event_id, supplier_id, state);

alter table bid_check enable row level security;
alter table bid_check force row level security;
create policy tenant_isolation on bid_check using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update, delete on bid_check to app_runtime;

-- The terms the reader found, kept per event so the page can show them without another model call.
create table bid_check_terms_cache (
  tenant_id  uuid not null references tenant(id),
  event_id   uuid not null,
  terms      jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (tenant_id, event_id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id)
);
alter table bid_check_terms_cache enable row level security;
alter table bid_check_terms_cache force row level security;
create policy tenant_isolation on bid_check_terms_cache using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update on bid_check_terms_cache to app_runtime;

select close_api_grants();
