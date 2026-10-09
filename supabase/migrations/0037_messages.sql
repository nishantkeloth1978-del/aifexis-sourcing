-- Event messaging: a public question and answer board, one private thread per supplier, and one-way notices.
alter table sourcing_event add column question_deadline timestamptz, add column last_answer_date timestamptz;

create table message_thread (
  tenant_id        uuid not null,
  id               uuid not null default gen_random_uuid(),
  event_id         uuid not null,
  lane             text not null check (lane in ('board', 'private', 'notice')),
  supplier_id      uuid,                                   -- board: the asker; private: the supplier; notice: null
  subject          text check (subject is null or length(subject) <= 200),
  anchor_item_id   uuid,                                   -- the line the question is about
  anchor_label     text check (anchor_label is null or length(anchor_label) <= 200),
  status           text not null default 'open' check (status in ('open', 'answered', 'closed', 'merged')),
  assignee_membership_id uuid,
  due_at           timestamptz,
  confidential     boolean not null default false,
  confidential_reason text check (confidential_reason is null or length(confidential_reason) <= 500),
  merged_into      uuid,
  public_question  text check (public_question is null or length(public_question) <= 4000),
  public_answer    text check (public_answer is null or length(public_answer) <= 4000),
  published_at     timestamptz,
  published_by     uuid,
  scope_change     boolean not null default false,
  request_due_at   timestamptz,                            -- private: the buyer asked for a reply by this time
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  legacy_id        uuid,
  primary key (tenant_id, id),
  foreign key (tenant_id, event_id) references sourcing_event (tenant_id, id),
  foreign key (tenant_id, supplier_id) references supplier_org (tenant_id, id),
  check (lane = 'notice' or supplier_id is not null)
);
create unique index message_thread_private_one on message_thread (tenant_id, event_id, supplier_id) where lane = 'private';
create index message_thread_event on message_thread (tenant_id, event_id, lane);
create unique index message_thread_legacy on message_thread (tenant_id, legacy_id) where legacy_id is not null;

create table message (
  tenant_id      uuid not null,
  id             uuid not null default gen_random_uuid(),
  seq            bigint generated always as identity,
  thread_id      uuid not null,
  event_id       uuid not null,
  author_kind    text not null check (author_kind in ('supplier', 'staff', 'system')),
  author_user_id uuid,
  body           text not null check (length(btrim(body)) between 1 and 4000),
  internal       boolean not null default false,           -- staff-only note
  guard_reason   text check (guard_reason is null or length(guard_reason) <= 500),
  created_at     timestamptz not null default now(),
  prev_hash      text not null default '',
  hash           text not null default '',
  primary key (tenant_id, id),
  foreign key (tenant_id, thread_id) references message_thread (tenant_id, id),
  check (not (internal and author_kind = 'supplier'))
);
create index message_thread_seq on message (tenant_id, thread_id, seq);

-- Each message carries a hash of the one before it in the same thread, so a missing or changed entry is detectable.
create function message_chain() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.thread_id::text));
  new.prev_hash := coalesce((select hash from message where tenant_id = new.tenant_id and thread_id = new.thread_id order by seq desc limit 1), '');
  new.hash := encode(sha256(convert_to(new.prev_hash || '|' || new.author_kind || '|' || coalesce(new.author_user_id::text, '') || '|' || new.internal::text || '|' || new.body || '|' || extract(epoch from new.created_at)::text, 'utf8')), 'hex');
  return new;
end $$;
create trigger message_chain before insert on message for each row execute function message_chain();
create function message_immutable() returns trigger language plpgsql as $$ begin raise exception 'messages cannot be changed or deleted'; end $$;
create trigger message_immutable before update or delete on message for each row execute function message_immutable();

create function message_chain_ok(p_thread uuid) returns boolean language plpgsql stable as $$
declare r record; prev text := ''; h text;
begin
  for r in select * from message where thread_id = p_thread order by seq loop
    h := encode(sha256(convert_to(prev || '|' || r.author_kind || '|' || coalesce(r.author_user_id::text, '') || '|' || r.internal::text || '|' || r.body || '|' || extract(epoch from r.created_at)::text, 'utf8')), 'hex');
    if r.prev_hash <> prev or r.hash <> h then return false; end if;
    prev := h;
  end loop;
  return true;
end $$;

create table message_file (
  tenant_id  uuid not null,
  id         uuid not null default gen_random_uuid(),
  message_id uuid not null,
  filename   text not null check (length(btrim(filename)) between 1 and 200),
  mime       text not null,
  size_bytes int not null check (size_bytes between 1 and 4194304),
  content    bytea not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, message_id) references message (tenant_id, id)
);

create table message_receipt (
  tenant_id  uuid not null,
  message_id uuid not null,
  user_id    uuid not null,
  read_at    timestamptz not null default now(),
  ack_at     timestamptz,
  primary key (tenant_id, message_id, user_id),
  foreign key (tenant_id, message_id) references message (tenant_id, id)
);

do $$ declare t text; begin
  foreach t in array array['message_thread', 'message', 'message_file', 'message_receipt'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())', t);
  end loop;
end $$;
grant select, insert, update on message_thread, message_receipt to app_runtime;
grant select, insert on message, message_file to app_runtime;

-- Bring the existing questions and answers across so no history is lost.
do $$
declare q record; a record; tid uuid;
begin
  for q in select * from clarification where kind = 'question' loop
    continue when exists (select 1 from message_thread where tenant_id = q.tenant_id and legacy_id = q.id);
    select * into a from clarification where parent_id = q.id and kind = 'answer' limit 1;
    insert into message_thread (tenant_id, event_id, lane, supplier_id, status, created_at, last_message_at, legacy_id,
                                public_question, public_answer, published_at)
    values (q.tenant_id, q.event_id, 'board', q.supplier_id, case when a.id is null then 'open' else 'answered' end, q.created_at, coalesce(a.created_at, q.created_at), q.id,
            case when a.visibility = 'shared' then coalesce(a.question_text, q.body) end, case when a.visibility = 'shared' then a.body end,
            case when a.visibility = 'shared' then a.created_at end)
    returning id into tid;
    insert into message (tenant_id, thread_id, event_id, author_kind, body, created_at) values (q.tenant_id, tid, q.event_id, 'supplier', q.body, q.created_at);
    if a.id is not null then
      insert into message (tenant_id, thread_id, event_id, author_kind, author_user_id, body, created_at)
      values (q.tenant_id, tid, q.event_id, 'staff', (select user_id from membership where tenant_id = a.tenant_id and id = a.author_membership_id), a.body, a.created_at);
    end if;
  end loop;
end $$;
