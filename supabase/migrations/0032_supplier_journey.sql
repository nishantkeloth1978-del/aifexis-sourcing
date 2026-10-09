-- Supplier journey: how long quotes stay valid (with per-supplier extensions) and debrief feedback to unsuccessful bidders.
alter table sourcing_event add column quote_validity_days int check (quote_validity_days is null or quote_validity_days between 1 and 730);

create table quote_extension (
  tenant_id   uuid not null,
  id          uuid not null default gen_random_uuid(),
  event_id    uuid not null,
  supplier_id uuid not null,
  valid_until date not null,
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id),
  unique (tenant_id, event_id, supplier_id)
);
create table bid_feedback (
  tenant_id   uuid not null,
  id          uuid not null default gen_random_uuid(),
  event_id    uuid not null,
  supplier_id uuid not null,
  message     text not null check (length(btrim(message)) between 10 and 2000),
  released_by uuid not null,
  released_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id),
  unique (tenant_id, event_id, supplier_id)
);
do $$ declare t text; begin
  foreach t in array array['quote_extension', 'bid_feedback'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())', t);
    execute format('grant select, insert, update, delete on %I to app_runtime', t);
  end loop;
end $$;
