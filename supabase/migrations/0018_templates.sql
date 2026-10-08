-- Industry-based sourcing templates: platform catalogue (shared, read-only) and tenant configuration.

-- ---------- Platform reference data (no tenant_id; the app can only read) ----------
create table industry (
  code         text primary key,
  label_en     text not null,
  label_ar     text not null,
  aliases      text[] not null default '{}',
  availability text not null check (availability in ('pack', 'general'))
);
create table purchase_category (
  code        text primary key,
  parent_code text references purchase_category(code),
  label_en    text not null,
  label_ar    text not null,
  synonyms    text[] not null default '{}'
);
create table industry_pack (
  code           text primary key,
  label_en       text not null,
  label_ar       text not null,
  industry_codes text[] not null,
  status         text not null default 'published' check (status in ('draft', 'published', 'archived'))
);
create table template_definition (
  key             text primary key,
  kind            text not null check (kind in ('general', 'scenario')),
  pack_code       text references industry_pack(code),
  category_code   text not null references purchase_category(code),
  event_type      text not null check (event_type in ('RFI', 'RFQ', 'RFP')),
  method          text not null default 'invited' check (method in ('open', 'invited', 'framework', 'single_source')),
  pricing_model   text not null check (pricing_model in ('itemized', 'person_day', 'manpower', 'subscription', 'milestone', 'freight', 'mixed', 'none')),
  title_en        text not null,
  title_ar        text not null,
  summary_en      text not null default '',
  summary_ar      text not null default ''
);
create table template_version (
  template_key  text not null references template_definition(key),
  version       int  not null check (version >= 1),
  schema_version int not null default 1,
  status        text not null check (status in ('draft', 'published', 'archived')),
  content       jsonb not null,
  content_hash  text not null,
  requires      text[] not null default '{}',
  change_note   text not null default '',
  published_at  timestamptz,
  primary key (template_key, version)
);
-- Published content never changes; only its status may move to archived.
create function template_version_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' then raise exception 'published template versions cannot be deleted'; end if;
    return old;
  end if;
  if old.status = 'published' and (new.content is distinct from old.content or new.content_hash is distinct from old.content_hash
       or new.version <> old.version or new.template_key <> old.template_key or new.requires is distinct from old.requires) then
    raise exception 'published template versions cannot be changed';
  end if;
  return new;
end $$;
create trigger template_version_guard before update or delete on template_version for each row execute function template_version_guard();

grant select on industry, purchase_category, industry_pack, template_definition to app_runtime;
-- Tenants see published versions only (drafts belong to platform administrators, who use the database directly).
create view template_version_published as select * from template_version where status in ('published', 'archived');
grant select on template_version_published to app_runtime;
revoke all on template_version from app_runtime;

-- ---------- Tenant configuration (one company per tenant for now) ----------
create table company_profile (
  tenant_id            uuid primary key references tenant(id),
  primary_industry     text references industry(code),
  additional_industries text[] not null default '{}',
  subsector            text check (subsector is null or length(subsector) <= 120),
  categories           text[] not null default '{}',
  country              text check (country is null or length(country) = 2),
  operating_locations  text[] not null default '{}',
  base_currency        text check (base_currency is null or length(base_currency) = 3),
  default_language     text not null default 'en' check (default_language in ('en', 'ar')),
  languages            text[] not null default '{en,ar}',
  time_zone            text,
  departments          text[] not null default '{}',
  status               text not null default 'not_started' check (status in ('not_started', 'in_progress', 'gaps', 'ready')),
  version              int not null default 1,
  updated_at           timestamptz not null default now(),
  updated_by           uuid
);
create table company_pack_assignment (
  tenant_id      uuid not null references tenant(id),
  template_key   text not null references template_definition(key),
  pinned_version int  not null,
  source         text not null default 'recommended' check (source in ('recommended', 'manual')),
  enabled        boolean not null default true,
  effective_from timestamptz not null default now(),
  primary key (tenant_id, template_key),
  foreign key (template_key, pinned_version) references template_version (template_key, version)
);
create table company_policy (
  tenant_id  uuid not null references tenant(id),
  key        text not null check (length(key) between 1 and 80),
  kind       text not null check (kind in ('require_document', 'require_question', 'require_field', 'note')),
  target     text not null check (length(target) between 1 and 80),   -- stable key of the locked object
  confirmed  boolean not null default false,
  confirmed_by uuid,
  note       text check (note is null or length(note) <= 500),
  primary key (tenant_id, key)
);
create table company_override (
  tenant_id    uuid not null references tenant(id),
  id           uuid not null default gen_random_uuid(),
  template_key text references template_definition(key),           -- null = applies to every template
  scope        text not null default 'company' check (scope = 'company' or scope like 'dept:%'),
  collection   text not null check (collection in ('sections', 'fields', 'questions', 'documents', 'criteria', 'lines')),
  object_key   text not null check (length(object_key) between 1 and 80),
  op           text not null check (op in ('add', 'update', 'remove')),
  value        jsonb,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  primary key (tenant_id, id)
);
create table company_config_version (
  tenant_id       uuid not null references tenant(id),
  id              uuid not null default gen_random_uuid(),
  version         int  not null,
  status          text not null check (status in ('active', 'superseded')),
  snapshot        jsonb not null,           -- pinned template versions and override ids in force
  hash            text not null,
  idempotency_key text not null,
  reason          text not null default '',
  created_by      uuid,
  created_at      timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, version),
  unique (tenant_id, idempotency_key)
);
create unique index company_config_one_active on company_config_version (tenant_id) where status = 'active';

do $$ declare t text; begin
  foreach t in array array['company_profile', 'company_pack_assignment', 'company_policy', 'company_override', 'company_config_version'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())', t);
    execute format('grant select, insert, update, delete on %I to app_runtime', t);
  end loop;
end $$;

-- ---------- Event link ----------
alter table sourcing_event
  add column template_key      text references template_definition(key),
  add column template_version  int,
  add column config_version    int,
  add column template_inputs   jsonb,
  add column template_effective jsonb,
  add column template_hash     text,
  add column template_frozen_at timestamptz;

create function template_snapshot_guard() returns trigger language plpgsql as $$
begin
  if old.template_frozen_at is not null and (new.template_effective is distinct from old.template_effective or new.template_inputs is distinct from old.template_inputs
       or new.template_key is distinct from old.template_key or new.template_version is distinct from old.template_version or new.template_hash is distinct from old.template_hash) then
    raise exception 'the template snapshot of a submitted event cannot change';
  end if;
  return new;
end $$;
create trigger template_snapshot_guard before update on sourcing_event for each row execute function template_snapshot_guard();

-- ---------- Catalogue seed ----------
insert into industry (code, label_en, label_ar, availability) values
 ('OIL_GAS','Oil and gas','النفط والغاز','pack'),
 ('CHEMICALS','Petrochemicals and chemicals','البتروكيماويات والكيماويات','general'),
 ('POWER_ENERGY','Power utilities and renewable energy','المرافق الكهربائية والطاقة المتجددة','general'),
 ('WATER_ENVIRONMENT','Water, waste and environmental services','المياه والنفايات والخدمات البيئية','general'),
 ('MINING','Mining and quarrying','التعدين واستخراج الحجارة','general'),
 ('CONSTRUCTION','Construction and infrastructure','الإنشاءات والبنية التحتية','pack'),
 ('REAL_ESTATE','Real estate and property development','العقارات والتطوير العقاري','general'),
 ('FACILITIES','Facilities management','إدارة المرافق','pack'),
 ('MANUFACTURING','General manufacturing','التصنيع العام','pack'),
 ('AUTOMOTIVE','Automotive and components','السيارات ومكوناتها','general'),
 ('AEROSPACE_DEFENCE','Aerospace and defence','الطيران والدفاع','general'),
 ('MARINE_OFFSHORE','Marine, shipbuilding and offshore operations','البحرية وبناء السفن والعمليات البحرية','general'),
 ('PORTS','Ports and terminals','الموانئ والمحطات','general'),
 ('LOGISTICS','Logistics, freight and warehousing','الخدمات اللوجستية والشحن والتخزين','pack'),
 ('AVIATION','Airlines and airports','شركات الطيران والمطارات','general'),
 ('RAIL_TRANSPORT','Rail and public transport','السكك الحديدية والنقل العام','general'),
 ('HEALTHCARE','Healthcare and hospitals','الرعاية الصحية والمستشفيات','pack'),
 ('PHARMA_BIOTECH','Pharmaceuticals and biotechnology','الأدوية والتقنية الحيوية','general'),
 ('EDUCATION_RESEARCH','Education and research','التعليم والبحث','general'),
 ('PUBLIC_SECTOR','Government and public sector organisations','الجهات الحكومية والقطاع العام','general'),
 ('FINANCIAL_SERVICES','Banking, insurance and financial services','البنوك والتأمين والخدمات المالية','general'),
 ('IT_SOFTWARE','IT, software and cloud services','تقنية المعلومات والبرمجيات والخدمات السحابية','pack'),
 ('TELECOM','Telecommunications','الاتصالات','general'),
 ('RETAIL','Retail, wholesale and e-commerce','التجزئة والجملة والتجارة الإلكترونية','general'),
 ('FMCG_FOOD','FMCG and food manufacturing','السلع الاستهلاكية وتصنيع الأغذية','general'),
 ('AGRICULTURE','Agriculture, fisheries and farming','الزراعة والثروة السمكية','general'),
 ('HOSPITALITY','Hospitality and tourism','الضيافة والسياحة','general'),
 ('CATERING','Catering, including offshore catering','خدمات التموين بما فيها التموين البحري','pack'),
 ('STAFFING','Staffing and manpower outsourcing','التوظيف وتوريد العمالة','pack'),
 ('AV_SECURITY','AV, physical security and smart buildings','الأنظمة السمعية والبصرية والأمن والمباني الذكية','pack'),
 ('MEDIA_MARKETING','Media, marketing and printing','الإعلام والتسويق والطباعة','general'),
 ('EVENTS_SPORTS','Events, entertainment and sports','الفعاليات والترفيه والرياضة','general'),
 ('TEXTILES','Textiles, fashion and uniforms','المنسوجات والأزياء والزي الموحد','general'),
 ('PACKAGING','Packaging, paper and plastics','التغليف والورق والبلاستيك','general'),
 ('NGO_HUMANITARIAN','NGOs and humanitarian organisations','المنظمات غير الحكومية والإنسانية','general');

insert into purchase_category (code, parent_code, label_en, label_ar, synonyms) values
 ('GENERAL',null,'General sourcing','المشتريات العامة','{}'),
 ('GOODS','GENERAL','Goods and equipment','السلع والمعدات','{}'),
 ('SERVICES','GENERAL','Services','الخدمات','{}'),
 ('AV_SYSTEMS','GOODS','AV and systems equipment','معدات الأنظمة السمعية والبصرية','{"audio visual","displays","video wall","security equipment","cctv"}'),
 ('AV_INSTALL','SERVICES','AV installation and commissioning','تركيب وتشغيل الأنظمة السمعية والبصرية','{"installation","commissioning"}'),
 ('MAINTENANCE_SERVICE','SERVICES','Maintenance service','خدمات الصيانة','{"support","maintenance contract"}'),
 ('CATERING_SERVICE','SERVICES','Catering and meal service','خدمات التموين والوجبات','{"meals","offshore catering","vessel catering"}'),
 ('FOOD_SUPPLY','GOODS','Food supply','توريد الأغذية','{"groceries","provisions"}'),
 ('KITCHEN_OPERATION','SERVICES','Kitchen operation','تشغيل المطابخ','{"camp kitchen"}'),
 ('MANPOWER','SERVICES','Manpower and staffing','القوى العاملة والتوظيف','{"staff augmentation","labour"}'),
 ('CONSTRUCTION_WORKS','SERVICES','Construction works','أعمال الإنشاءات','{"civil works","subcontract"}'),
 ('FACILITIES_SERVICE','SERVICES','Facilities services','خدمات المرافق','{"cleaning","hvac"}'),
 ('RAW_MATERIAL','GOODS','Raw materials and components','المواد الخام والمكونات','{"parts"}'),
 ('FREIGHT','SERVICES','Freight and transport','الشحن والنقل','{"shipping","trucking"}'),
 ('MEDICAL_EQUIPMENT','GOODS','Medical equipment and consumables','المعدات والمستهلكات الطبية','{"clinical"}'),
 ('IT_SOFTWARE','SERVICES','IT and software','تقنية المعلومات والبرمجيات','{"licences","cloud","saas"}');

-- Lines created from a template are marked so they can be rebuilt when the buyer changes the inputs.
alter table event_item add column template_line text;
