-- AI status line on the Configuration page: one platform-wide row about the Anthropic key's health.
-- Holds no customer data and no key material, only when a call last worked or failed and a short reason code.
create table if not exists ai_status (
  id           text primary key default 'platform' check (id = 'platform'),
  last_ok_at   timestamptz,
  last_fail_at timestamptz,
  last_reason  text,
  ok_count     bigint not null default 0,
  fail_count   bigint not null default 0
);
alter table ai_status enable row level security; alter table ai_status force row level security;
revoke all on ai_status from public;

create or replace function ai_status_record(p_ok boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into ai_status (id) values ('platform') on conflict (id) do nothing;
  if p_ok then
    update ai_status set last_ok_at = now(), ok_count = ok_count + 1 where id = 'platform';
  else
    update ai_status set last_fail_at = now(), last_reason = left(coalesce(p_reason, 'error'), 40), fail_count = fail_count + 1 where id = 'platform';
  end if;
end $$;

create or replace function ai_status_get() returns table (last_ok_at timestamptz, last_fail_at timestamptz, last_reason text, ok_count bigint, fail_count bigint)
language sql security definer set search_path = public as $$
  select last_ok_at, last_fail_at, last_reason, ok_count, fail_count from ai_status where id = 'platform'
$$;

revoke all on function ai_status_record(boolean, text) from public;
revoke all on function ai_status_get() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'app_runtime') then
    grant execute on function ai_status_record(boolean, text) to app_runtime;
    grant execute on function ai_status_get() to app_runtime;
  end if;
end $$;

select close_api_grants();
