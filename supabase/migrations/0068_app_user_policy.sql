-- app_user holds login identities and has no tenant column, so the application reads and writes it directly.
-- Some Supabase projects switch row security on for every table; with no policy that hides every row from the app
-- (Users list, event Team, invitations and Autopilot all read it). This policy restores the intended access for our two
-- application roles only. Supabase's own API roles (anon, authenticated) get nothing: close_api_grants() keeps them out.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_runtime') then
    execute 'drop policy if exists app_user_app on app_user';
    execute 'create policy app_user_app on app_user for all to app_runtime, app_supplier using (true) with check (true)';
  end if;
end $$;
select close_api_grants();
