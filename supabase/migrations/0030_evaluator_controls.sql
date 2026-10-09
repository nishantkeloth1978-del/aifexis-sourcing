-- Evaluator controls: conflict-of-interest declarations, moderation of score differences, and a record of every score change.
create table evaluator_declaration (
  tenant_id     uuid not null,
  event_id      uuid not null,
  membership_id uuid not null,
  has_conflict  boolean not null,
  detail        text not null default '' check (length(detail) <= 1000),
  declared_at   timestamptz not null default now(),
  primary key (tenant_id, event_id, membership_id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, membership_id) references membership (tenant_id, id)
);
create table score_moderation (
  tenant_id     uuid not null,
  event_id      uuid not null,
  supplier_id   uuid not null,
  criterion     text not null,
  reason        text not null check (length(btrim(reason)) between 5 and 1000),
  by_membership uuid not null,
  at            timestamptz not null default now(),
  primary key (tenant_id, event_id, supplier_id, criterion),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id)
);
create table score_change (
  tenant_id      uuid not null,
  id             uuid not null default gen_random_uuid(),
  event_id       uuid not null,
  supplier_id    uuid not null,
  evaluator_membership_id uuid not null,
  criterion      text not null,
  old_score      numeric(6, 2) not null,
  new_score      numeric(6, 2) not null,
  reason         text not null check (length(btrim(reason)) between 5 and 1000),
  material       boolean not null default false,
  needs_approval boolean not null default false,
  approved_by    uuid,
  approved_at    timestamptz,
  at             timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id)
);
do $$ declare t text; begin
  foreach t in array array['evaluator_declaration', 'score_moderation', 'score_change'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())', t);
    execute format('grant select, insert, update on %I to app_runtime', t);
  end loop;
end $$;
-- A declaration is final once made; score changes keep their history and may only be approved.
create function evaluator_declaration_final() returns trigger language plpgsql as $$
begin raise exception 'a conflict declaration cannot be changed' using errcode = 'check_violation'; end $$;
create trigger evaluator_declaration_final before update or delete on evaluator_declaration for each row execute function evaluator_declaration_final();
create function score_change_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'score changes cannot be deleted' using errcode = 'check_violation'; end if;
  if (to_jsonb(new) - 'approved_by' - 'approved_at') is distinct from (to_jsonb(old) - 'approved_by' - 'approved_at') then raise exception 'score changes cannot be edited' using errcode = 'check_violation'; end if;
  return new;
end $$;
create trigger score_change_guard before update or delete on score_change for each row execute function score_change_guard();
