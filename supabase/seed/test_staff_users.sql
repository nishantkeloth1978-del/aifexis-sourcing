-- NEVER RUN IN PRODUCTION: this creates logins with a shared, known password. Remove them afterwards with the matching *_remove.sql script.
-- Aifexis Sourcing: 14 staff logins for one organisation, for testing roles and approvals.
--   buyer01..buyer05, manager01..manager05, vp01..vp03, ceo  (all @aifexis.com), password below.
-- Everyone is an ordinary member. Titles are only in the e-mail address: what each person may do on an event
-- comes from the event team (Team tab) and the approval routes (Approvers page), not from the title.
-- Run in the Supabase SQL Editor. Safe to re-run: existing accounts keep their password. Test environments only.
do $$
declare
  v_company text := null;          -- put your company name here if you have more than one company
  v_password text := 'abcd1234';
  v_tenant uuid; v_n int; r record; v_auth uuid; v_user uuid; v_made int := 0;
begin
  if to_regclass('auth.users') is null then raise exception 'auth.users not found: run this in the Supabase SQL Editor.'; end if;
  select count(*) into v_n from tenant where v_company is null or name ilike v_company;
  if v_n <> 1 then raise exception 'Set v_company to your exact company name. Companies: %', (select string_agg(name, ', ') from tenant); end if;
  select id into v_tenant from tenant where v_company is null or name ilike v_company;
  perform set_config('app.tenant_id', v_tenant::text, true);

  for r in
    select lower(e) || '@aifexis.com' as email from (
      select 'buyer' || lpad(g::text, 2, '0') as e from generate_series(1, 5) g
      union all select 'manager' || lpad(g::text, 2, '0') from generate_series(1, 5) g
      union all select 'vp' || lpad(g::text, 2, '0') from generate_series(1, 3) g
      union all select 'ceo') x
  loop
    select id into v_auth from auth.users where lower(email) = r.email;
    if v_auth is null then
      v_auth := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                              created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', v_auth, 'authenticated', 'authenticated', r.email,
              extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
              '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), v_auth, v_auth::text, 'email', jsonb_build_object('sub', v_auth::text, 'email', r.email, 'email_verified', true), now(), now(), now());
      v_made := v_made + 1;
    end if;
    select id into v_user from app_user where lower(email) = r.email;
    if v_user is null then
      insert into app_user (email, auth_user_id) values (r.email, v_auth) returning id into v_user;
    else
      update app_user set auth_user_id = v_auth where id = v_user and auth_user_id is null;
    end if;
    insert into membership (tenant_id, user_id, role) values (v_tenant, v_user, 'member') on conflict do nothing;
  end loop;
  raise notice 'Staff logins ready (% new). Password: %', v_made, v_password;
end $$;
