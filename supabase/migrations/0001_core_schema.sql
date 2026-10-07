-- Aifexis Sourcing: Stage 0 core schema.
-- Conventions
--  * Every tenant-owned table has tenant_id. Foreign keys are composite (tenant_id, id) so a child can never point at another tenant's parent.
--  * Bid content carries a data class: D6 = envelope 1 (technical), D7 = envelope 2 (commercial).
--    Derived content (extracted text, previews, search entries, AI chunks) carries D8 (from D6) or D9 (from D7).
--  * Submitted bids, openings, approvals, calculation runs, and audit events are append-only.

create type event_state as enum (
  'draft', 'pending_publication', 'published', 'closed', 'technical_evaluation',
  'technical_approved', 'commercial_evaluation', 'recommended', 'pending_award',
  'awarded', 'handover_pending', 'handed_over', 'archived', 'cancelled', 'retendered'
);

create table tenant (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table app_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique
);

create table membership (
  tenant_id uuid not null references tenant(id),
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references app_user(id),
  role text not null check (role in ('admin', 'integration_admin', 'member')),
  primary key (tenant_id, id),
  unique (tenant_id, user_id, role)
);

create table supplier_org (
  tenant_id uuid not null references tenant(id),
  id uuid not null default gen_random_uuid(),
  name text not null,
  primary key (tenant_id, id)
);

create table supplier_user (
  tenant_id uuid not null,
  supplier_id uuid not null,
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references app_user(id),
  primary key (tenant_id, id),
  unique (tenant_id, supplier_id, user_id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id)
);

create table tenant_config (
  tenant_id uuid not null references tenant(id),
  version int not null,
  model jsonb not null,
  primary key (tenant_id, version)
);

create table sourcing_event (
  tenant_id uuid not null references tenant(id),
  id uuid not null default gen_random_uuid(),
  title text not null,
  state event_state not null default 'draft',
  state_version int not null default 0,              -- optimistic concurrency
  current_version int not null default 1,            -- event definition version (amendments increment it)
  value_aed numeric(18, 2),
  closes_at timestamptz,
  envelope1_opened_at timestamptz,
  envelope2_opened_at timestamptz,
  required_award_approvals int not null default 1 check (required_award_approvals >= 1),
  config_snapshot jsonb,                             -- configuration in force at publication
  primary key (tenant_id, id)
);

create table event_member (
  tenant_id uuid not null,
  event_id uuid not null,
  membership_id uuid not null,
  event_role text not null check (event_role in (
    'requester', 'buyer', 'tech_evaluator', 'comm_evaluator', 'witness',
    'publication_approver', 'tech_approver', 'award_approver', 'auditor')),
  conflict_declared boolean not null default false,
  primary key (tenant_id, event_id, membership_id, event_role),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, membership_id) references membership (tenant_id, id)
);

create table delegation (
  tenant_id uuid not null,
  event_id uuid not null,
  id uuid not null default gen_random_uuid(),
  from_membership_id uuid not null,
  to_membership_id uuid not null,
  primary key (tenant_id, id),
  unique (tenant_id, event_id, from_membership_id, to_membership_id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, from_membership_id) references membership (tenant_id, id),
  foreign key (tenant_id, to_membership_id) references membership (tenant_id, id)
);

create table invitation (
  tenant_id uuid not null,
  event_id uuid not null,
  supplier_id uuid not null,
  id uuid not null default gen_random_uuid(),
  token_hash text not null unique,
  primary key (tenant_id, id),
  unique (tenant_id, event_id, supplier_id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id)
);

create table qualified_bidder (
  tenant_id uuid not null,
  event_id uuid not null,
  supplier_id uuid not null,
  approved_at timestamptz not null default now(),
  superseded_at timestamptz,
  primary key (tenant_id, event_id, supplier_id, approved_at),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id)
);

create table opening_record (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  envelope smallint not null check (envelope in (1, 2)),
  opened_by uuid not null,
  witness uuid,
  opened_at timestamptz not null default now(),
  qualified_supplier_ids uuid[],                     -- envelope 2: the bidders whose envelope was opened
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id)
);

create table clarification (                         -- data class D5
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  supplier_id uuid,                                  -- asking supplier, if any
  visibility text not null check (visibility in ('shared', 'private')),
  body text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id)
);

create table bid_revision (
  tenant_id uuid not null,
  event_id uuid not null,
  supplier_id uuid not null,
  id uuid not null default gen_random_uuid(),
  revision_no int not null,
  submitted_at timestamptz not null default now(),
  idempotency_key text not null,
  primary key (tenant_id, id),
  unique (tenant_id, event_id, supplier_id, revision_no),
  unique (tenant_id, event_id, supplier_id, idempotency_key),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id)
);

create table bid_item (
  tenant_id uuid not null,
  bid_revision_id uuid not null,
  id uuid not null default gen_random_uuid(),
  data_class text not null check (data_class in ('D6', 'D7')),
  kind text not null,
  payload jsonb not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, bid_revision_id) references bid_revision (tenant_id, id)
);

create table derived_item (
  tenant_id uuid not null,
  bid_item_id uuid not null,
  id uuid not null default gen_random_uuid(),
  data_class text not null check (data_class in ('D8', 'D9')),
  kind text not null,
  content text not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, bid_item_id) references bid_item (tenant_id, id)
);

create table stored_object (                         -- private documents; the class decides who may receive a signed URL
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  supplier_id uuid,
  data_class text not null check (data_class in ('D1', 'D2', 'D6', 'D7', 'D8', 'D9')),
  path text not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id)
);

create table gate_result (                           -- D10
  tenant_id uuid not null,
  event_id uuid not null,
  supplier_id uuid not null,
  passed boolean not null,
  reason text,
  primary key (tenant_id, event_id, supplier_id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id)
);

create table tech_score (                            -- D11 (individual scores)
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  supplier_id uuid not null,
  evaluator_membership_id uuid not null,
  criterion text not null,
  score numeric(6, 2) not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id),
  foreign key (tenant_id, evaluator_membership_id) references membership (tenant_id, id)
);

create table tech_result (                           -- D12 (final technical result)
  tenant_id uuid not null,
  event_id uuid not null,
  supplier_id uuid not null,
  total numeric(6, 2) not null,
  qualified boolean not null,
  primary key (tenant_id, event_id, supplier_id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id)
);

create table calculation_run (                       -- D13, append-only
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  model_version text not null,
  status text not null check (status in ('COMPLETE', 'INCOMPLETE')),
  input_hash text not null,
  inputs jsonb not null,
  outputs jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id)
);

create table approval (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  step text not null,
  approver_membership_id uuid not null,
  decision text not null check (decision in ('approve', 'reject')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, event_id, step, approver_membership_id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, approver_membership_id) references membership (tenant_id, id)
);

create table break_glass_grant (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  operator_id uuid not null,
  event_id uuid not null,
  approved_by uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id)
);

create table audit_event (
  tenant_id uuid not null,
  id bigint generated always as identity primary key,
  event_id uuid,
  actor text,
  action text not null,
  detail jsonb,
  at timestamptz not null default now()
);

create table outbox (
  tenant_id uuid not null,
  id bigint generated always as identity primary key,
  event_id uuid,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

-- ---------------------------------------------------------------- integrity triggers

create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'immutable record: % on %', tg_op, tg_table_name;
end $$;

create trigger bid_revision_immutable before update or delete on bid_revision for each row execute function forbid_change();
create trigger bid_item_immutable before update or delete on bid_item for each row execute function forbid_change();
create trigger derived_item_immutable before update or delete on derived_item for each row execute function forbid_change();
create trigger opening_record_immutable before update or delete on opening_record for each row execute function forbid_change();
create trigger calculation_run_immutable before update or delete on calculation_run for each row execute function forbid_change();
create trigger approval_immutable before update or delete on approval for each row execute function forbid_change();
create trigger audit_immutable before update or delete on audit_event for each row execute function forbid_change();

-- A derived item must carry the class derived from its source (D6 -> D8, D7 -> D9).
create function check_derived_class() returns trigger language plpgsql as $$
declare src text;
begin
  select data_class into src from bid_item where tenant_id = new.tenant_id and id = new.bid_item_id;
  if (src = 'D6' and new.data_class <> 'D8') or (src = 'D7' and new.data_class <> 'D9') then
    raise exception 'derived class % does not match source class %', new.data_class, src;
  end if;
  return new;
end $$;
create trigger derived_class_check before insert on derived_item for each row execute function check_derived_class();

-- Separation of duties at assignment time.
--  * a person cannot be both technical and commercial evaluator on one event
--  * the buyer cannot hold an approver or witness role on the same event
--  * an evaluator cannot be a witness or an approver on the same event
create function check_event_member_duties() returns trigger language plpgsql as $$
declare conflict_roles text[];
begin
  conflict_roles := case new.event_role
    when 'tech_evaluator' then array['comm_evaluator', 'buyer', 'witness', 'tech_approver', 'award_approver', 'publication_approver']
    when 'comm_evaluator' then array['tech_evaluator', 'buyer', 'witness', 'tech_approver', 'award_approver', 'publication_approver']
    when 'buyer' then array['tech_approver', 'award_approver', 'publication_approver', 'witness', 'tech_evaluator', 'comm_evaluator']
    when 'witness' then array['buyer', 'tech_evaluator', 'comm_evaluator']
    when 'tech_approver' then array['buyer', 'tech_evaluator', 'comm_evaluator']
    when 'award_approver' then array['buyer', 'tech_evaluator', 'comm_evaluator']
    when 'publication_approver' then array['buyer', 'tech_evaluator', 'comm_evaluator']
    else array[]::text[]
  end;
  if exists (
    select 1 from event_member em
    where em.tenant_id = new.tenant_id and em.event_id = new.event_id
      and em.membership_id = new.membership_id and em.event_role = any (conflict_roles)
  ) then
    raise exception 'separation of duties: % conflicts with an existing role of the same member on this event', new.event_role;
  end if;
  return new;
end $$;
create trigger event_member_duties before insert on event_member for each row execute function check_event_member_duties();
