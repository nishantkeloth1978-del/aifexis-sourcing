-- Messaging M3: reply by e-mail, translations with the original kept, amendment notice link.
alter table email_outbox add column reply_to text;
alter table message_thread add column amendment_notice_id uuid;

-- Cached machine translations. The original message is never changed; a translation is only a view of it.
create table message_translation (
  tenant_id  uuid not null,
  source     text not null,                       -- a message id, or "<thread id>:q" / "<thread id>:a" for a published question or answer
  lang       text not null check (lang in ('en', 'ar')),
  body       text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, source, lang)
);
alter table message_translation enable row level security;
alter table message_translation force row level security;
create policy tenant_isolation on message_translation using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert on message_translation to app_runtime;

-- Reply tokens: one unguessable address part per (private thread, person). The table is closed to the runtime role;
-- the two functions below are the only way in. Resolving a token happens before any tenant is known, so it is a definer function.
create table reply_token (
  token      text primary key,
  tenant_id  uuid not null,
  thread_id  uuid not null,
  user_id    uuid not null,
  created_at timestamptz not null default now(),
  unique (thread_id, user_id)
);
alter table reply_token enable row level security;
revoke all on reply_token from app_runtime;

create or replace function issue_reply_token(p_thread uuid, p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_token text;
begin
  select tenant_id into v_tenant from message_thread where id = p_thread and tenant_id = current_tenant();
  if v_tenant is null then return null; end if;
  select token into v_token from reply_token where thread_id = p_thread and user_id = p_user;
  if v_token is not null then return v_token; end if;
  v_token := replace(gen_random_uuid()::text, '-', '');
  insert into reply_token (token, tenant_id, thread_id, user_id) values (v_token, v_tenant, p_thread, p_user)
    on conflict (thread_id, user_id) do nothing;
  select token into v_token from reply_token where thread_id = p_thread and user_id = p_user;
  return v_token;
end $$;

create or replace function resolve_reply_token(p_token text) returns table (tenant_id uuid, thread_id uuid, user_id uuid)
language sql security definer set search_path = public as $$
  select t.tenant_id, t.thread_id, t.user_id from reply_token t where t.token = p_token and t.created_at > now() - interval '120 days';
$$;
grant execute on function issue_reply_token(uuid, uuid), resolve_reply_token(text) to app_runtime;
