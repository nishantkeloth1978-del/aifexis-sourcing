-- Re-seed platform catalogue (industries, categories). Idempotent: safe to run any number of times.

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
 ('NGO_HUMANITARIAN','NGOs and humanitarian organisations','المنظمات غير الحكومية والإنسانية','general') on conflict (code) do nothing;

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
 ('IT_SOFTWARE','SERVICES','IT and software','تقنية المعلومات والبرمجيات','{"licences","cloud","saas"}') on conflict (code) do nothing;

insert into purchase_category (code, parent_code, label_en, label_ar, synonyms) values
 ('OIL_GAS_SERVICES','SERVICES','Oil and gas services','خدمات النفط والغاز','{"shutdown","turnaround","plant services"}'),
 ('OIL_GAS_MRO','GOODS','MRO materials and spares','مواد الصيانة والتشغيل وقطع الغيار','{"spares","consumables","mro"}'),
 ('WAREHOUSING','SERVICES','Warehousing and distribution','التخزين والتوزيع','{"storage","3pl"}') on conflict (code) do nothing;

insert into industry_pack (code, label_en, label_ar, industry_codes) values ('AV_SYSTEMS', 'AV and system integration', 'الأنظمة السمعية والبصرية وتكامل الأنظمة', '{"AV_SECURITY"}') on conflict (code) do nothing;

insert into industry_pack (code, label_en, label_ar, industry_codes) values ('CATERING_PACK', 'Catering and offshore services', 'التموين والخدمات البحرية', '{"CATERING"}') on conflict (code) do nothing;

insert into industry_pack (code, label_en, label_ar, industry_codes) values ('CONSTRUCTION_PACK', 'Construction and infrastructure', 'الإنشاءات والبنية التحتية', '{"CONSTRUCTION"}') on conflict (code) do nothing;

insert into industry_pack (code, label_en, label_ar, industry_codes) values ('STAFFING_PACK', 'Staffing and manpower', 'التوظيف وتوريد العمالة', '{"STAFFING"}') on conflict (code) do nothing;

insert into industry_pack (code, label_en, label_ar, industry_codes) values ('FACILITIES_PACK', 'Facilities management', 'إدارة المرافق', '{"FACILITIES"}') on conflict (code) do nothing;

insert into industry_pack (code, label_en, label_ar, industry_codes) values ('MANUFACTURING_PACK', 'Manufacturing', 'التصنيع', '{"MANUFACTURING"}') on conflict (code) do nothing;

insert into industry_pack (code, label_en, label_ar, industry_codes) values ('OILGAS_PACK', 'Oil and gas', 'النفط والغاز', '{"OIL_GAS"}') on conflict (code) do nothing;

insert into industry_pack (code, label_en, label_ar, industry_codes) values ('LOGISTICS_PACK', 'Logistics and warehousing', 'الخدمات اللوجستية والتخزين', '{"LOGISTICS"}') on conflict (code) do nothing;

insert into industry_pack (code, label_en, label_ar, industry_codes) values ('HEALTHCARE_PACK', 'Healthcare', 'الرعاية الصحية', '{"HEALTHCARE"}') on conflict (code) do nothing;

insert into industry_pack (code, label_en, label_ar, industry_codes) values ('IT_PACK', 'IT and software', 'تقنية المعلومات والبرمجيات', '{"IT_SOFTWARE"}') on conflict (code) do nothing;
