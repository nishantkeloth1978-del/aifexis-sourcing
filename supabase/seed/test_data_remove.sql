-- Removes everything created by test_data.sql (suppliers TST-V*, items TST-*, events titled [TEST]...).
-- Supplier logins made by test_suppliers_login.sql (run in the same editor; needs the auth schema).
do $$
declare v_company text := null; v_tenant uuid; v_emails text[];
begin
  select id into v_tenant from tenant where v_company is null or name ilike v_company;
  if (select count(*) from tenant where v_company is null or name ilike v_company) <> 1 then raise exception 'Set v_company to your exact company name.'; end if;
  select array_agg(lower(contact_email)) into v_emails from supplier_org where tenant_id = v_tenant and vendor_code like 'TST-V%';
  delete from invitation where tenant_id = v_tenant and supplier_id in (select id from supplier_org where vendor_code like 'TST-V%');
  delete from supplier_user where tenant_id = v_tenant and supplier_id in (select id from supplier_org where vendor_code like 'TST-V%');
  if to_regclass('auth.users') is not null then
    delete from auth.identities where user_id in (select id from auth.users where lower(email) = any(v_emails));
    delete from auth.users where lower(email) = any(v_emails);
  end if;
  delete from app_user where lower(email) = any(v_emails);
end $$;

do $$
declare v_company text := null;   -- put your company name here if you have more than one company
  v_tenant uuid; v_n int;
begin
  select count(*) into v_n from tenant where v_company is null or name ilike v_company;
  if v_n <> 1 then raise exception 'Set v_company to your exact company name. Companies: %', (select string_agg(name, ', ') from tenant); end if;
  select id into v_tenant from tenant where v_company is null or name ilike v_company;
  update sourcing_event set state = 'draft' where tenant_id = v_tenant and title like '[TEST]%';
  delete from invitation where tenant_id = v_tenant and event_id in (select id from sourcing_event where title like '[TEST]%');
  delete from event_item where tenant_id = v_tenant and event_id in (select id from sourcing_event where title like '[TEST]%');
  delete from event_member where tenant_id = v_tenant and event_id in (select id from sourcing_event where title like '[TEST]%');
  delete from sourcing_event where tenant_id = v_tenant and title like '[TEST]%';
  delete from supplier_org where tenant_id = v_tenant and vendor_code like 'TST-V%';
  delete from catalog_item where tenant_id = v_tenant and code like 'TST-%';
end $$;
