-- Generic health rows for platform services (first user: the malware scanner). No customer data, no secrets: timestamps, counters, a reason code.
create table if not exists service_status (
  service      text primary key check (service ~ '^[a-z_]{1,30}$'),
  last_ok_at   timestamptz,
  last_fail_at timestamptz,
  last_reason  text,
  ok_count     bigint not null default 0,
  fail_count   bigint not null default 0
);
alter table service_status enable row level security; alter table service_status force row level security;
revoke all on service_status from public;

create or replace function service_status_record(p_service text, p_ok boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into service_status (service) values (p_service) on conflict (service) do nothing;
  if p_ok then
    update service_status set last_ok_at = now(), ok_count = ok_count + 1 where service = p_service;
  else
    update service_status set last_fail_at = now(), last_reason = left(coalesce(p_reason, 'error'), 40), fail_count = fail_count + 1 where service = p_service;
  end if;
end $$;

create or replace function service_status_get(p_service text) returns table (last_ok_at timestamptz, last_fail_at timestamptz, last_reason text, ok_count bigint, fail_count bigint)
language sql security definer set search_path = public as $$
  select last_ok_at, last_fail_at, last_reason, ok_count, fail_count from service_status where service = p_service
$$;

revoke all on function service_status_record(text, boolean, text) from public;
revoke all on function service_status_get(text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'app_runtime') then
    grant execute on function service_status_record(text, boolean, text) to app_runtime;
    grant execute on function service_status_get(text) to app_runtime;
  end if;
end $$;

select close_api_grants();
