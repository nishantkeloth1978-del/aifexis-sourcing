import { ask, buyer, doc, group, input, line, opts, pack, supplier, yesno } from "./build";

/** Release 4: five more scenarios, one for each of five existing packs. Seeded as version 1 by migration 0036. */
export const CONSTRUCTION_2 = pack("CONSTRUCTION_PACK", [
  { key: "CON_MATERIALS_RFQ", type: "RFQ", category: "CONSTRUCTION_WORKS", title: ["Construction materials supply RFQ", "طلب عرض سعر توريد مواد إنشائية"], summary: ["Cement, steel, blocks and similar materials delivered to site, priced per unit.", "إسمنت وحديد وبلوك ومواد مماثلة تُسلَّم للموقع بتسعير لكل وحدة."], model: "itemized", leadTime: true,
    fields: [buyer("site_location", "general", ["Delivery site", "موقع التسليم"], "text", true), supplier("country_of_origin", "equipment", ["Country of origin", "بلد المنشأ"], "text", true), supplier("delivery_phasing", "mobilisation", ["Can you deliver in phases as the site requires?", "هل يمكنكم التسليم على دفعات حسب حاجة الموقع؟"], "boolean", true)],
    questions: [yesno("standards", ["Do the materials comply with the standards in the specification?", "هل المواد مطابقة للمعايير الواردة في المواصفات؟"], "qualification")],
    documents: [doc("test_certs", ["Material test certificates", "شهادات اختبار المواد"], ["Traceability and compliance of the supplied materials.", "تتبع المواد الموردة ومطابقتها."]), doc("samples", ["Sample approval records", "سجلات اعتماد العينات"], ["Samples approved on earlier projects.", "عينات معتمدة في مشاريع سابقة."])] },
]);

export const FACILITIES_2 = pack("FACILITIES_PACK", [
  { key: "FAC_AMC_RFP", type: "RFP", category: "FACILITIES_SERVICE", title: ["Annual maintenance contract RFP", "طلب عرض عقد صيانة سنوي"], summary: ["Planned and breakdown maintenance of installed equipment, priced per asset group per year.", "صيانة دورية وطارئة للمعدات المركبة بتسعير لكل مجموعة أصول سنويًا."], model: "subscription",
    fields: [buyer("response_hours", "general", ["Required response time for breakdowns (hours)", "زمن الاستجابة المطلوب للأعطال (بالساعات)"], "integer", true), supplier("spares_included", "service", ["Are spare parts included in the fee?", "هل قطع الغيار مشمولة في الرسم؟"], "boolean", true), supplier("visits_per_year", "service", ["Planned visits per year", "الزيارات الدورية في السنة"], "integer", true)],
    questions: [ask("maintenance_plan", ["Describe the maintenance plan, escalation and reporting.", "صفوا خطة الصيانة والتصعيد والتقارير."]), yesno("kpi_ok", ["Do you accept service levels with deductions for misses?", "هل تقبلون مستويات خدمة مع خصومات عند التقصير؟"], "info")],
    groups: [group("asset_group", ["Asset group", "مجموعة الأصول"], [input("years", ["Years", "السنوات"], "integer", true, 1)])],
    lines: [line("annual_fee", ["Annual fee: {name}", "الرسم السنوي: {name}"], "years", "YEAR", "UNIT_PRICE", { group: "asset_group" }), line("callout", ["Extra call-out (per visit)", "زيارة إضافية (لكل زيارة)"], "1", "VISIT", "UNIT_PRICE", { optional: true })],
    documents: [doc("asset_list", ["Assets you propose to cover", "الأصول التي تقترحون تغطيتها"], ["Confirms the scope of cover.", "تؤكد نطاق التغطية."], ["pdf", "xlsx"])] },
]);

export const IT_2 = pack("IT_PACK", [
  { key: "IT_HARDWARE_RFQ", type: "RFQ", category: "IT_SOFTWARE", title: ["IT hardware RFQ", "طلب عرض سعر أجهزة تقنية معلومات"], summary: ["Laptops, servers and network equipment with warranty and delivery terms.", "حواسيب محمولة وخوادم ومعدات شبكات مع الضمان وشروط التسليم."], model: "itemized", leadTime: true,
    fields: [buyer("delivery_site", "general", ["Delivery site", "موقع التسليم"], "text", true), supplier("manufacturer", "equipment", ["Manufacturer and model", "المصنّع والطراز"], "text", true), supplier("warranty_months", "warranty", ["Warranty period (months)", "مدة الضمان (بالأشهر)"], "integer", true), supplier("onsite_support", "warranty", ["Is on-site warranty support included?", "هل يشمل الضمان دعمًا في الموقع؟"], "boolean", true)],
    questions: [yesno("authorised", ["Are you an authorised reseller of the manufacturer?", "هل أنتم موزع معتمد لدى المصنّع؟"], "qualification")],
    documents: [doc("datasheet", ["Technical datasheets", "الأوراق الفنية"], ["Specification of the offered equipment.", "مواصفات المعدات المعروضة."]), doc("authorisation", ["Manufacturer authorisation letter", "خطاب تفويض من المصنّع"], ["Shows you may sell and support these products.", "يثبت أحقيتكم في بيع هذه المنتجات ودعمها."])] },
]);

export const LOGISTICS_2 = pack("LOGISTICS_PACK", [
  { key: "LOG_FLEET_HIRE_RFQ", type: "RFQ", category: "FREIGHT", title: ["Vehicle and fleet hire RFQ", "طلب عرض سعر تأجير مركبات وأسطول"], summary: ["Vehicles with or without drivers, priced per vehicle per month with extra-kilometre charges.", "مركبات بسائق أو بدونه بتسعير شهري لكل مركبة مع رسوم الكيلومترات الإضافية."], model: "subscription",
    fields: [buyer("hire_months", "general", ["Hire duration (months)", "مدة التأجير (بالأشهر)"], "integer", true), supplier("driver_included", "service", ["Is a driver included?", "هل يشمل السائق؟"], "boolean", true), supplier("replacement_hours", "service", ["Hours to supply a replacement vehicle", "ساعات توفير مركبة بديلة"], "integer", true)],
    questions: [yesno("insured", ["Are all vehicles comprehensively insured and registered?", "هل جميع المركبات مؤمنة بالكامل ومسجلة؟"], "qualification")],
    groups: [group("vehicle", ["Vehicle type", "نوع المركبة"], [input("units", ["Number of vehicles", "عدد المركبات"], "integer"), input("months", ["Months", "الأشهر"], "integer", true, 12), input("extra_km", ["Expected extra kilometres", "الكيلومترات الإضافية المتوقعة"], "decimal", false, 0)])],
    lines: [line("monthly", ["Monthly hire: {name}", "التأجير الشهري: {name}"], "units * months", "VEHICLE-MONTH", "UNIT_PRICE", { group: "vehicle" }), line("extra_km", ["Extra kilometres: {name}", "الكيلومترات الإضافية: {name}"], "extra_km", "KM", "UNIT_PRICE", { group: "vehicle", when: "extra_km > 0" })],
    documents: [doc("fleet_list", ["Vehicles you propose", "المركبات التي تقترحونها"], ["Model, age and registration of each vehicle.", "الطراز والعمر والتسجيل لكل مركبة."], ["pdf", "xlsx"])] },
]);

export const OILGAS_2 = pack("OILGAS_PACK", [
  { key: "OG_INSPECTION_RFQ", type: "RFQ", category: "OIL_GAS_SERVICES", title: ["Inspection and testing services RFQ", "طلب عرض سعر خدمات الفحص والاختبار"], summary: ["Certified inspectors priced per day, with mobilisation and reporting.", "مفتشون معتمدون بتسعير يومي مع التعبئة وإعداد التقارير."], model: "person_day",
    fields: [buyer("plant_site", "general", ["Plant or site", "المصنع أو الموقع"], "text", true), supplier("accreditation", "service", ["Accreditation held (for example ISO 17020)", "الاعتماد المتوفر (مثل ISO 17020)"], "text", true), supplier("availability_date", "mobilisation", ["Earliest start date", "أقرب تاريخ للبدء"], "date", true)],
    questions: [yesno("certified", ["Are all proposed inspectors certified for the methods required?", "هل جميع المفتشين المقترحين معتمدون للطرق المطلوبة؟"], "qualification"), yesno("hse_ok", ["Can your inspectors work under the site permit-to-work system?", "هل يمكن لمفتشيكم العمل ضمن نظام تصاريح العمل بالموقع؟"], "qualification")],
    groups: [group("role", ["Inspector grade", "درجة المفتش"], [input("people", ["Number of people", "عدد الأشخاص"], "integer"), input("days", ["Days each", "الأيام لكل شخص"], "integer")])],
    lines: [line("day_rate", ["Day rate: {name}", "الأجر اليومي: {name}"], "people * days", "PERSON-DAY", "UNIT_PRICE", { group: "role" }), line("report", ["Final report and data book", "التقرير النهائي وسجل البيانات"], "1", "LS", "LUMP_SUM", { optional: true })],
    documents: [doc("certificates", ["Inspector certificates", "شهادات المفتشين"], ["Evidence of competence for each method.", "ما يثبت الكفاءة لكل طريقة."])] },
]);
