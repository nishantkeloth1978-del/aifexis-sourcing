-- A third kind of runner: a signed-in page view that finds the last run more than a minute old (a backup for when no worker is running).
alter table autonomy_run drop constraint autonomy_run_last_source_check;
alter table autonomy_run add constraint autonomy_run_last_source_check check (last_source in ('worker', 'cron', 'page'));

select close_api_grants();
