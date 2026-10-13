-- Removes the 14 test staff logins made by test_staff_users.sql. Fails if one of them is already on an event team or has other history.
do $$
declare v_tenant uuid; v_n int; v_company text := null;
begin
  select count(*) into v_n from tenant where v_company is null or name ilike v_company;
  if v_n <> 1 then raise exception 'Set v_company to your exact company name.'; end if;
  select id into v_tenant from tenant where v_company is null or name ilike v_company;
  perform set_config('app.tenant_id', v_tenant::text, true);
  create temp table _u on commit drop as
    select id, auth_user_id from app_user where email ~ '^(buyer0[1-5]|manager0[1-5]|vp0[1-3]|ceo)@aifexis\.com$';
  delete from membership where user_id in (select id from _u);
  delete from app_user where id in (select id from _u);
  delete from auth.identities where user_id in (select auth_user_id from _u);
  delete from auth.users where id in (select auth_user_id from _u);
  raise notice 'Test staff logins removed';
end $$;
