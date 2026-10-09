-- Aifexis Sourcing: login accounts for the 10 test suppliers (run test_data.sql first).
-- Each supplier gets a login whose username is the supplier's contact email and whose password is set below.
-- They are also linked to their company and accepted on the open [TEST] event, so they can sign in at once.
-- Safe to re-run: existing accounts keep their password. Test environments only.
do $$
declare
  v_company text := null;          -- put your company name here if you have more than one company
  v_password text := 'abcd1234';
  v_tenant uuid; v_n int; v_event uuid; r record; v_auth uuid; v_user uuid; v_su uuid;
begin
  if to_regclass('auth.users') is null then raise exception 'auth.users not found: run this in the Supabase SQL Editor.'; end if;
  select count(*) into v_n from tenant where v_company is null or name ilike v_company;
  if v_n <> 1 then raise exception 'Set v_company to your exact company name. Companies: %', (select string_agg(name, ', ') from tenant); end if;
  select id into v_tenant from tenant where v_company is null or name ilike v_company;
  perform set_config('app.tenant_id', v_tenant::text, true);
  select id into v_event from sourcing_event where tenant_id = v_tenant and title like '[TEST] Staff catering%' limit 1;

  for r in select id, name, lower(contact_email) as email from supplier_org
            where tenant_id = v_tenant and vendor_code like 'TST-V%' and contact_email is not null order by vendor_code
  loop
    -- 1. the sign-in account
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
    end if;

    -- 2. link it to the application user and the supplier
    select id into v_user from app_user where lower(email) = r.email;
    if v_user is null then
      insert into app_user (email, auth_user_id) values (r.email, v_auth) returning id into v_user;
    else
      update app_user set auth_user_id = v_auth where id = v_user and auth_user_id is null;
    end if;
    select id into v_su from supplier_user where tenant_id = v_tenant and supplier_id = r.id and user_id = v_user;
    if v_su is null then
      insert into supplier_user (tenant_id, supplier_id, user_id) values (v_tenant, r.id, v_user) returning id into v_su;
    end if;

    -- 3. invite to the open test event (if not already) and mark accepted
    if v_event is not null then
      insert into invitation (tenant_id, event_id, supplier_id, token_hash, expires_at)
      values (v_tenant, v_event, r.id, md5(random()::text || r.id::text), now() + interval '14 days')
      on conflict (tenant_id, event_id, supplier_id) do nothing;
      update invitation set supplier_user_id = v_su, accepted_at = coalesce(accepted_at, now())
       where tenant_id = v_tenant and event_id = v_event and supplier_id = r.id;
    end if;
  end loop;
  raise notice 'Supplier logins ready';
end $$;
