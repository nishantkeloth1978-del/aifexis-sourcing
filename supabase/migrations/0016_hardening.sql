-- Rate limiting: fixed windows kept in Postgres so it works across serverless instances.
-- Not tenant data: no RLS policies, no direct grants; callers use rate_hit() only.
create table if not exists rate_limit (
  bucket       text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (bucket, window_start)
);
alter table rate_limit enable row level security;
revoke all on rate_limit from public;

-- Counts one hit and returns true when the caller is still within p_max for the current window.
create or replace function rate_hit(p_bucket text, p_window_secs integer, p_max integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_secs) * p_window_secs);
  n integer;
begin
  if p_window_secs < 1 or p_max < 1 or length(p_bucket) > 300 then raise exception 'bad rate limit arguments'; end if;
  insert into rate_limit (bucket, window_start, hits) values (p_bucket, w, 1)
    on conflict (bucket, window_start) do update set hits = rate_limit.hits + 1
    returning hits into n;
  if random() < 0.02 then delete from rate_limit where window_start < now() - interval '1 day'; end if;
  return n <= p_max;
end $$;
revoke all on function rate_hit(text, integer, integer) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'app_runtime') then grant execute on function rate_hit(text, integer, integer) to app_runtime; end if;
end $$;
