-- Line items to be priced in an event. Editable only while the event is a draft (later changes are versioned amendments).
create table event_item (
  tenant_id uuid not null references tenant(id),
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  line_no int not null,
  description text not null check (length(btrim(description)) between 1 and 500),
  quantity numeric(18, 3) not null check (quantity > 0),
  unit text not null check (length(btrim(unit)) between 1 and 20),
  block_type text not null default 'UNIT_PRICE' check (block_type in ('UNIT_PRICE', 'LUMP_SUM', 'RATE_X_EST_QTY', 'CAPPED_AMOUNT')),
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  unique (tenant_id, event_id, line_no)
);
alter table event_item enable row level security;
alter table event_item force row level security;
create policy tenant_isolation on event_item using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update, delete on event_item to app_runtime;

create function check_event_item_draft() returns trigger language plpgsql as $$
declare st event_state; eid uuid; tid uuid;
begin
  if tg_op = 'DELETE' then eid := old.event_id; tid := old.tenant_id; else eid := new.event_id; tid := new.tenant_id; end if;
  select state into st from sourcing_event where tenant_id = tid and id = eid;
  if st is distinct from 'draft' then
    raise exception 'event items can only change while the event is a draft' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;
create trigger event_item_draft_only before insert or update or delete on event_item
  for each row execute function check_event_item_draft();
