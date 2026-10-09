import type { DocumentReq, Field, Question, TemplateContent, TemplateSeed } from "../types";
import { l } from "./common";

/**
 * Release 3: brings every template up to common market practice (typical sourcing and tender documents).
 * Existing objects are never touched: anything a template already has under the same key is kept as it is.
 * Published versions are immutable, so this produces version 2 of each template; companies upgrade when they choose.
 */
const INCOTERMS = ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"].map((k) => ({ key: k.toLowerCase(), label: l(k, k) }));
const buyer = (key: string, section: string, en: string, ar: string, type: Field["type"], extra: Partial<Field> = {}): Field => ({ key, section, label: l(en, ar), type, source: "buyer", envelope: "technical", required: false, ...extra });
const supplier = (key: string, section: string, en: string, ar: string, type: Field["type"], extra: Partial<Field> = {}): Field => ({ key, section, label: l(en, ar), type, source: "supplier", envelope: "technical", required: false, ...extra });
const yn = (key: string, en: string, ar: string, use: Question["use"], required: boolean | string, section = "technical"): Question => ({ key, section, label: l(en, ar), type: "yesno", use, required });
const doc = (key: string, en: string, ar: string, pen: string, par: string, required: boolean | string, extra: Partial<DocumentReq> = {}): DocumentReq => ({ key, label: l(en, ar), purpose: l(pen, par), required, origin: "suggested", envelope: "technical", fileTypes: ["pdf"], ...extra });

const buyerHeader = (): Field[] => [
  buyer("buyer_contact", "general", "Contact person for questions", "الشخص المسؤول عن الاستفسارات", "text"),
  buyer("clarification_deadline", "general", "Last date for supplier questions", "آخر موعد لأسئلة الموردين", "date"),
  buyer("delivery_location", "mobilisation", "Delivery or work location", "موقع التسليم أو العمل", "text", { required: true }),
  buyer("required_date", "mobilisation", "Required delivery or start date", "تاريخ التسليم أو البدء المطلوب", "date"),
  buyer("requested_payment_terms", "commercial", "Payment terms requested", "شروط الدفع المطلوبة", "text", { envelope: "commercial" }),
  buyer("bid_bond_required", "commercial", "Bid bond required", "هل الضمان الابتدائي مطلوب", "boolean", { default: false }),
  buyer("bid_bond_percent", "commercial", "Bid bond (% of offer value)", "الضمان الابتدائي (٪ من قيمة العرض)", "decimal", { visible: "bid_bond_required == true", required: "bid_bond_required == true" }),
  buyer("performance_bond_percent", "commercial", "Performance bond (% of contract value)", "ضمان حسن التنفيذ (٪ من قيمة العقد)", "decimal"),
  buyer("governing_law", "general", "Governing law and jurisdiction", "القانون الواجب التطبيق والاختصاص القضائي", "text"),
];
const goodsHeader = (): Field[] => [
  buyer("incoterms", "mobilisation", "Delivery terms (Incoterms 2020)", "شروط التسليم (إنكوترمز 2020)", "single", { options: INCOTERMS }),
  buyer("inspection_requirement", "technical", "Inspection and testing before shipment", "الفحص والاختبار قبل الشحن", "text"),
];
const supplierCommercial = (): Field[] => [
  supplier("vat_treatment", "commercial", "Prices are", "الأسعار", "single", { envelope: "commercial", required: true, options: [{ key: "excl", label: l("Exclusive of VAT", "غير شاملة ضريبة القيمة المضافة") }, { key: "incl", label: l("Inclusive of VAT", "شاملة ضريبة القيمة المضافة") }] }),
  supplier("price_validity_note", "commercial", "Price adjustment or escalation (if any)", "تعديل الأسعار أو التصعيد (إن وجد)", "text", { envelope: "commercial" }),
  supplier("alternate_offer", "technical", "Do you also offer an alternate or equivalent solution?", "هل تقدمون أيضًا بديلًا أو حلًا مكافئًا؟", "boolean", { default: false }),
  supplier("alternate_description", "technical", "Describe the alternate offer", "صفوا العرض البديل", "longtext", { visible: "alternate_offer == true", required: "alternate_offer == true" }),
  supplier("supplier_contact", "general", "Your contact person and email", "اسم جهة الاتصال لديكم وبريدها", "text", { required: true }),
];
const goodsSupplier = (): Field[] => [
  supplier("incoterms_offered", "mobilisation", "Delivery terms offered (Incoterms 2020)", "شروط التسليم المعروضة (إنكوترمز 2020)", "single", { options: INCOTERMS }),
  supplier("country_of_origin", "equipment", "Country of origin", "بلد المنشأ", "text"),
  supplier("manufacturer", "equipment", "Manufacturer and brand", "الشركة المصنعة والعلامة التجارية", "text"),
  supplier("hs_code", "equipment", "HS code (customs tariff)", "رمز النظام المنسق (التعرفة الجمركية)", "text"),
  supplier("min_order_qty", "commercial", "Minimum order quantity", "الحد الأدنى للكمية", "decimal", { envelope: "commercial" }),
  supplier("warranty_months", "warranty", "Warranty period (months)", "مدة الضمان (بالأشهر)", "integer"),
  supplier("spares_availability_years", "warranty", "Spare parts availability (years)", "توافر قطع الغيار (بالسنوات)", "integer"),
];

const compliance = (): Question[] => [
  yn("accept_terms", "Do you accept the buyer's terms and conditions without exception?", "هل تقبلون شروط وأحكام المشتري دون استثناء؟", "qualification", true, "general"),
  yn("sanctions_declaration", "Do you confirm that neither your company nor its owners are subject to applicable sanctions?", "هل تؤكدون أن شركتكم ومالكيها غير خاضعين للعقوبات المعمول بها؟", "qualification", true, "general"),
  yn("anti_bribery", "Do you confirm compliance with applicable anti-bribery and anti-corruption laws?", "هل تؤكدون الالتزام بقوانين مكافحة الرشوة والفساد المعمول بها؟", "qualification", true, "general"),
  yn("conflict_of_interest", "Do you confirm that you have no conflict of interest in this tender?", "هل تؤكدون عدم وجود تضارب مصالح في هذه المناقصة؟", "qualification", true, "general"),
  yn("iso_9001", "Do you hold a current ISO 9001 quality certificate?", "هل تحملون شهادة جودة ISO 9001 سارية؟", "info", false),
  yn("subcontracting", "Will any part of the work be subcontracted?", "هل سيتم إسناد أي جزء من العمل لمتعاقدين من الباطن؟", "info", true),
  yn("litigation", "Are you party to any current litigation or arbitration that could affect this work?", "هل أنتم طرف في دعاوى أو تحكيم حالي قد يؤثر على هذا العمل؟", "info", false),
  { key: "deviations", section: "general", label: l("List any deviations from the tender requirements (or write 'None')", "اذكروا أي انحرافات عن متطلبات المناقصة (أو اكتبوا 'لا يوجد')"), type: "text", use: "info", required: true },
];
const rfpExtra = (): Question[] => [
  yn("hse_policy", "Do you have a documented health, safety and environment policy?", "هل لديكم سياسة موثقة للصحة والسلامة والبيئة؟", "info", false),
  yn("insurance", "Do you hold public liability and professional indemnity insurance?", "هل لديكم تأمين مسؤولية عامة وتعويض مهني؟", "info", false),
  yn("data_protection", "Will you comply with the buyer's data protection and confidentiality requirements?", "هل ستلتزمون بمتطلبات حماية البيانات والسرية لدى المشتري؟", "qualification", true),
  { key: "financial_standing", section: "general", label: l("Describe your financial standing (turnover for the last three years)", "صفوا مركزكم المالي (حجم الأعمال لآخر ثلاث سنوات)"), type: "text", use: "info", required: false },
  { key: "implementation_plan", section: "technical", label: l("Provide an implementation plan with key milestones", "قدموا خطة تنفيذ بأهم المراحل"), type: "text", use: "scoring", required: false },
];

const docs = (rfi: boolean): DocumentReq[] => [
  doc("trade_licence", "Trade licence", "الرخصة التجارية", "Proves the company is registered and allowed to trade.", "تثبت تسجيل الشركة وترخيصها بالتجارة.", false, { expiry: true }),
  doc("tax_registration", "Tax registration certificate", "شهادة التسجيل الضريبي", "Tax or VAT registration.", "التسجيل الضريبي أو ضريبة القيمة المضافة.", false),
  ...(rfi ? [] : [
    doc("bank_letter", "Bank reference letter", "خطاب مرجعي من البنك", "Confirms financial standing.", "يؤكد المركز المالي.", false),
    doc("quality_certificates", "Quality and HSE certificates", "شهادات الجودة والصحة والسلامة", "ISO 9001, ISO 45001, ISO 14001 or equivalent.", "ISO 9001 أو ISO 45001 أو ISO 14001 أو ما يماثلها.", false, { expiry: true }),
    doc("insurance_certificate", "Insurance certificate", "شهادة التأمين", "Public liability and other cover relevant to the work.", "المسؤولية العامة وأي تغطية متعلقة بالعمل.", false, { expiry: true }),
    doc("bid_bond", "Bid bond", "الضمان الابتدائي", "Bank guarantee for the percentage stated in the tender.", "ضمان بنكي بالنسبة المحددة في المناقصة.", "bid_bond_required == true"),
    doc("signed_declaration", "Signed declaration and acceptance of terms", "إقرار موقع وقبول الشروط", "Signed by an authorised signatory.", "موقع من مفوض بالتوقيع.", false),
  ]),
];
const goodsDocs = (): DocumentReq[] => [
  doc("datasheets", "Product datasheets", "الأوراق الفنية للمنتجات", "Shows the offered item meets the specification.", "توضح أن الصنف المعروض يطابق المواصفات.", false),
  doc("coo_certificate", "Certificate of origin (if available)", "شهادة المنشأ (إن وجدت)", "Supports the country of origin stated.", "تدعم بلد المنشأ المذكور.", false),
];

const addBy = <T extends { key: string }>(have: T[], add: T[]): T[] => [...have, ...add.filter((a) => !have.some((h) => h.key === a.key))];

export function enrich(seed: TemplateSeed): TemplateSeed {
  const c: TemplateContent = JSON.parse(JSON.stringify(seed.content));
  const { eventType: ev, pricingModel } = seed.meta;
  const rfi = ev === "RFI", rfp = ev === "RFP", goods = ev === "RFQ" && pricingModel === "itemized";
  c.fields = addBy(c.fields, rfi ? buyerHeader().filter((f) => ["buyer_contact", "clarification_deadline"].includes(f.key)) : [...buyerHeader(), ...(goods ? goodsHeader() : []), ...supplierCommercial(), ...(goods ? goodsSupplier() : [])]);
  c.questions = addBy(c.questions, rfi ? compliance().filter((q) => ["sanctions_declaration", "anti_bribery", "iso_9001"].includes(q.key)) : [...compliance(), ...(rfp ? rfpExtra() : [])]);
  c.documents = addBy(c.documents, [...docs(rfi), ...(goods ? goodsDocs() : [])]);
  if (!rfi && c.evaluation.criteria.length === 0) {
    c.evaluation.criteria = rfp
      ? [{ key: "technical_fit", label: l("Technical fit", "الملاءمة الفنية") }, { key: "delivery_plan", label: l("Delivery plan and timeline", "خطة التنفيذ والجدول الزمني") }, { key: "compliance_risk", label: l("Compliance and risk", "الالتزام والمخاطر") }]
      : [{ key: "technical_compliance", label: l("Technical compliance", "المطابقة الفنية") }, { key: "delivery_lead_time", label: l("Delivery and lead time", "التسليم ومدة التوريد") }, { key: "commercial_terms", label: l("Commercial terms and warranty", "الشروط التجارية والضمان") }, { key: "supplier_capability", label: l("Supplier capability and references", "قدرة المورد والمراجع") }];
  }
  if (goods && !c.evaluation.modes.includes("weighted")) c.evaluation.modes = [...c.evaluation.modes, "weighted"];
  return { ...seed, version: seed.version + 1, changeNote: "Market-standard release: buyer header, commercial terms, compliance declarations, standard documents and evaluation criteria", content: c };
}
