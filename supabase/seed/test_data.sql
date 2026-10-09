-- Aifexis Sourcing: test data (10 suppliers, 50 catalogue materials, 4 sample events).
-- Run in the Supabase SQL Editor. Safe to re-run: existing rows are skipped.
-- Everything is tagged: vendor codes and item codes start with TST-, event titles start with [TEST].
-- Supplier emails use example.com, so nothing real can be contacted.
-- Remove it all with supabase/seed/test_data_remove.sql.
do $$
declare
  v_company text := null;      -- put your company name here if you have more than one company
  v_tenant uuid; v_member uuid; v_n int;
  v_event uuid; v_lot uuid; v_year int := extract(year from now());
  r record; n int;
begin
  -- 1. pick the company
  select count(*) into v_n from tenant where v_company is null or name ilike v_company;
  if v_n = 0 then raise exception 'No company found. Set v_company to your company name.'; end if;
  if v_n > 1 then raise exception 'More than one company found. Set v_company to the exact name: %', (select string_agg(name, ', ') from tenant); end if;
  select id into v_tenant from tenant where v_company is null or name ilike v_company;
  select id into v_member from membership where tenant_id = v_tenant and role = 'admin' order by id limit 1;
  if v_member is null then select id into v_member from membership where tenant_id = v_tenant order by id limit 1; end if;
  if v_member is null then raise exception 'The company has no members yet. Sign in once first.'; end if;
  perform set_config('app.tenant_id', v_tenant::text, true);

  -- 2. ten suppliers
  insert into supplier_org (tenant_id, name, vendor_code, country, category, phone, tax_no, contact_name, contact_email, notes)
  select v_tenant, s.name, s.code, s.country, s.category, s.phone, s.tax, s.contact, s.email, 'Test data'
  from (values
    ('Gulf AV Solutions LLC',           'TST-V001', 'United Arab Emirates', 'AV and systems',        '+971 2 555 0101', '100234567800003', 'Omar Haddad',     'omar@gulfav.example.com'),
    ('Emirates Display Trading',        'TST-V002', 'United Arab Emirates', 'AV and systems',        '+971 4 555 0102', '100234567800011', 'Layla Nasser',    'layla@emdisplay.example.com'),
    ('Al Noor Electrical Supplies',     'TST-V003', 'United Arab Emirates', 'Electrical',            '+971 2 555 0103', '100234567800029', 'Faisal Rahman',   'faisal@alnoor.example.com'),
    ('Desert Cable and Network FZE',    'TST-V004', 'United Arab Emirates', 'IT and networking',     '+971 6 555 0104', '100234567800037', 'Priya Menon',     'priya@desertcable.example.com'),
    ('Horizon Catering Services',       'TST-V005', 'United Arab Emirates', 'Catering',              '+971 2 555 0105', '100234567800045', 'Khalid Saeed',    'khalid@horizoncatering.example.com'),
    ('Pearl Foodstuff Trading',         'TST-V006', 'United Arab Emirates', 'Catering',              '+971 4 555 0106', '100234567800052', 'Mariam Yusuf',    'mariam@pearlfood.example.com'),
    ('Falcon Building Materials',       'TST-V007', 'United Arab Emirates', 'Construction',          '+971 2 555 0107', '100234567800060', 'Sanjay Kapoor',   'sanjay@falconbm.example.com'),
    ('Oasis Safety and PPE',            'TST-V008', 'Oman',                 'Safety',                '+968 2455 0108',  'OM1234567',       'Hassan Al Balushi','hassan@oasissafety.example.com'),
    ('Nile Technical Equipment',        'TST-V009', 'Egypt',                'AV and systems',        '+20 2 5550 0109', 'EG98765432',      'Amr Fathy',       'amr@niletech.example.com'),
    ('Bluewave Office and IT Supplies', 'TST-V010', 'Saudi Arabia',         'IT and networking',     '+966 11 555 0110','SA300123456700003','Noura Al Otaibi','noura@bluewave.example.com')
  ) as s(name, code, country, category, phone, tax, contact, email)
  where not exists (select 1 from supplier_org o where o.tenant_id = v_tenant and lower(o.vendor_code) = lower(s.code));

  -- 3. fifty catalogue materials
  insert into catalog_item (tenant_id, code, description, unit, category)
  select v_tenant, m.code, m.descr, m.unit, m.cat
  from (values
    ('TST-AV-001','55-inch commercial 4K display','EA','AV and systems'),
    ('TST-AV-002','75-inch commercial 4K display','EA','AV and systems'),
    ('TST-AV-003','Wall mount bracket, tilting, up to 75 inch','EA','AV and systems'),
    ('TST-AV-004','Ceiling speaker, 6.5 inch, 100V line','EA','AV and systems'),
    ('TST-AV-005','Wireless handheld microphone system','EA','AV and systems'),
    ('TST-AV-006','Gooseneck conference microphone','EA','AV and systems'),
    ('TST-AV-007','8-channel digital audio mixer','EA','AV and systems'),
    ('TST-AV-008','HDMI matrix switcher 8x8','EA','AV and systems'),
    ('TST-AV-009','PTZ conference camera, 20x zoom','EA','AV and systems'),
    ('TST-AV-010','Laser projector, 6000 lumens','EA','AV and systems'),
    ('TST-AV-011','HDMI cable, 10 m, high speed','EA','AV and systems'),
    ('TST-AV-012','Touch panel controller, 10 inch','EA','AV and systems'),
    ('TST-NET-001','Cat6A U/UTP cable, 305 m box','BOX','IT and networking'),
    ('TST-NET-002','Cat6A patch panel, 24 port','EA','IT and networking'),
    ('TST-NET-003','Cat6A patch cord, 2 m','EA','IT and networking'),
    ('TST-NET-004','Managed PoE switch, 24 port','EA','IT and networking'),
    ('TST-NET-005','Wireless access point, Wi-Fi 6','EA','IT and networking'),
    ('TST-NET-006','Fibre patch cord, LC-LC, 3 m','EA','IT and networking'),
    ('TST-NET-007','19-inch server rack, 42U','EA','IT and networking'),
    ('TST-NET-008','Rack-mount UPS, 3 kVA','EA','IT and networking'),
    ('TST-NET-009','Business laptop, 14 inch, 16 GB','EA','IT and networking'),
    ('TST-NET-010','Network label and cable tie kit','KIT','IT and networking'),
    ('TST-ELE-001','Power cable 3x2.5 mm2, 100 m drum','DRUM','Electrical'),
    ('TST-ELE-002','Distribution board, 12 way','EA','Electrical'),
    ('TST-ELE-003','Circuit breaker MCB 32 A','EA','Electrical'),
    ('TST-ELE-004','Cable tray, galvanised, 3 m length','EA','Electrical'),
    ('TST-ELE-005','LED panel light 600x600, 40 W','EA','Electrical'),
    ('TST-ELE-006','Conduit PVC 25 mm, 3 m length','EA','Electrical'),
    ('TST-ELE-007','13 A double socket outlet','EA','Electrical'),
    ('TST-ELE-008','Floor box, 4 module','EA','Electrical'),
    ('TST-CAT-001','Basmati rice, 25 kg bag','BAG','Catering'),
    ('TST-CAT-002','Chicken breast, frozen, 10 kg carton','CTN','Catering'),
    ('TST-CAT-003','Cooking oil, 17 litre can','CAN','Catering'),
    ('TST-CAT-004','Fresh vegetables assorted, 10 kg crate','CRATE','Catering'),
    ('TST-CAT-005','Bottled water 500 ml, carton of 24','CTN','Catering'),
    ('TST-CAT-006','Disposable meal box, 500 pieces','CTN','Catering'),
    ('TST-CAT-007','Hot food container, stainless, 10 litre','EA','Catering'),
    ('TST-CAT-008','Catering gloves, nitrile, box of 100','BOX','Catering'),
    ('TST-CON-001','Portland cement, 50 kg bag','BAG','Construction'),
    ('TST-CON-002','Reinforcement steel bar 16 mm','TON','Construction'),
    ('TST-CON-003','Concrete block 200 mm','EA','Construction'),
    ('TST-CON-004','Ready-mix concrete C40','M3','Construction'),
    ('TST-CON-005','Plywood shuttering 18 mm','SHEET','Construction'),
    ('TST-CON-006','Floor tile porcelain 600x600','M2','Construction'),
    ('TST-CON-007','Interior emulsion paint, 18 litre','PAIL','Construction'),
    ('TST-SAF-001','Safety helmet, ANSI rated','EA','Safety'),
    ('TST-SAF-002','High-visibility vest','EA','Safety'),
    ('TST-SAF-003','Safety shoes, steel toe','PAIR','Safety'),
    ('TST-SAF-004','Fire extinguisher, 6 kg dry powder','EA','Safety'),
    ('TST-SAF-005','First aid kit, workplace, 50 person','EA','Safety')
  ) as m(code, descr, unit, cat)
  where not exists (select 1 from catalog_item c where c.tenant_id = v_tenant and upper(c.code) = upper(m.code));

  -- 4. sample events (skipped if an event with the same title already exists)
  for r in select * from (values
    (1, '[TEST] Conference room AV package',          'Projects', false, 'TST-AV-0',  12, null::text),
    (2, '[TEST] Office network and IT refresh',       'IT',       false, 'TST-NET-0', 10, null),
    (3, '[TEST] Site works materials (BOQ sections)', 'Projects', false, 'TST-CON-0', 7,  'sections'),
    (4, '[TEST] Staff catering supplies, open for bids','Operations', true, 'TST-CAT-0', 8, null)
  ) as e(no, title, dept, publish, prefix, cnt, mode)
  loop
    continue when exists (select 1 from sourcing_event where tenant_id = v_tenant and title = r.title);
    insert into event_counter (tenant_id, year, last) values (v_tenant, v_year, 1)
      on conflict (tenant_id, year) do update set last = event_counter.last + 1 returning last into n;
    insert into sourcing_event (tenant_id, title, ref, owner_dept, closes_at, created_by)
      values (v_tenant, r.title, format('EV-%s-%s', v_year, lpad(n::text, 3, '0')), r.dept, now() + interval '14 days', v_member) returning id into v_event;
    insert into event_member (tenant_id, event_id, membership_id, event_role) values (v_tenant, v_event, v_member, 'requester');
    insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, item_code, section)
    select v_tenant, v_event, row_number() over (order by code), description,
           (array[2,4,5,8,10,12,20,25,40,50,100,150])[1 + (abs(hashtext(code)) % 12)], unit, code,
           case when r.mode = 'sections' then (case when code <= 'TST-CON-003' then '1 Structure > 1.1 Masonry and cement' else '2 Finishes > 2.1 Floors and paint' end) end
      from (select * from catalog_item where tenant_id = v_tenant and code like r.prefix || '%' order by code limit r.cnt) c;
    if r.publish then
      insert into invitation (tenant_id, event_id, supplier_id, token_hash, expires_at, created_by)
      select v_tenant, v_event, o.id, md5(random()::text || o.id::text), now() + interval '14 days', v_member
        from supplier_org o where o.tenant_id = v_tenant and o.vendor_code in ('TST-V005','TST-V006','TST-V003','TST-V010','TST-V008');
      update sourcing_event set state = 'published' where tenant_id = v_tenant and id = v_event;
    end if;
  end loop;
  raise notice 'Test data ready for company %', (select name from tenant where id = v_tenant);
end $$;
