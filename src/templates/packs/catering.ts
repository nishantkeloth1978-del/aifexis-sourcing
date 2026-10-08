import type { TemplateSeed } from "../types";
import { companyProfileDoc, exclusionsField, l, offerValidity, paymentTerms, referencesQuestion } from "./common";

const meta = (key: string, eventType: "RFQ" | "RFP", category: string, title: [string, string], summary: [string, string], pricingModel: string) => ({
  key, kind: "scenario" as const, packCode: "CATERING_PACK", categoryCode: category, eventType, method: "invited", pricingModel, title: l(...title), summary: l(...summary), requires: ["rfx", "envelopes", "questionnaire", "line_pricing"],
});
const meals = [
  { key: "breakfast", label: l("Breakfast", "الإفطار") }, { key: "lunch", label: l("Lunch", "الغداء") }, { key: "dinner", label: l("Dinner", "العشاء") }, { key: "snacks", label: l("Snacks and refreshments", "الوجبات الخفيفة والمرطبات") },
];

export const CATERING: TemplateSeed[] = [
  {
    meta: meta("CAT_MEAL_SERVICE_RFP", "RFP", "CATERING_SERVICE", ["Meal service RFP (site or vessel)", "طلب عرض لخدمة الوجبات (موقع أو سفينة)"], ["Catering for one or more sites or vessels, priced per person per day plus mobilisation.", "تموين لموقع أو أكثر أو سفن، بتسعير لكل شخص في اليوم مع التعبئة."], "person_day"),
    version: 1, changeNote: "Initial release",
    content: {
      schema: 1, sections: [], documents: [
        { key: "sample_menu", label: l("Sample menu cycle", "نموذج دورة القوائم"), purpose: l("Shows variety and meal composition over the cycle.", "يبين التنوع وتركيب الوجبات خلال الدورة."), required: false, origin: "suggested", envelope: "technical", fileTypes: ["pdf", "docx", "xlsx"] },
        { key: "food_safety_evidence", label: l("Food safety management evidence", "ما يثبت إدارة سلامة الغذاء"), purpose: l("Evidence of how food safety is managed.", "ما يثبت كيفية إدارة سلامة الغذاء."), required: false, origin: "suggested", envelope: "technical", fileTypes: ["pdf"] },
        companyProfileDoc(),
      ],
      fields: [
        { key: "meal_scope", section: "general", label: l("Meals required", "الوجبات المطلوبة"), type: "multi", source: "buyer", envelope: "technical", required: true, options: meals },
        { key: "dietary_requirements", section: "general", label: l("Dietary and cultural requirements", "المتطلبات الغذائية والثقافية"), type: "longtext", source: "buyer", envelope: "technical", required: false },
        { key: "menu_cycle_days", section: "service", label: l("Menu cycle length (days)", "طول دورة القوائم (بالأيام)"), type: "integer", source: "supplier", envelope: "technical", required: true },
        { key: "menu_description", section: "service", label: l("Menu and meal composition", "القوائم وتركيب الوجبات"), type: "longtext", source: "supplier", envelope: "technical", required: true },
        { key: "mobilisation_days", section: "mobilisation", label: l("Days needed to mobilise", "أيام التعبئة اللازمة"), type: "integer", source: "supplier", envelope: "technical", required: true },
        offerValidity(), paymentTerms(), exclusionsField(),
      ],
      questions: [
        { key: "service_plan", section: "technical", label: l("Describe how you will deliver the service on site or on board.", "صفوا كيف ستقدمون الخدمة في الموقع أو على متن السفينة."), type: "text", use: "scoring", required: true },
        referencesQuestion(),
      ],
      pricing: {
        model: "person_day",
        groups: [{ key: "site", label: l("Site or vessel", "الموقع أو السفينة"), repeat: true, inputs: [
          { key: "headcount", label: l("People served", "عدد الأشخاص"), type: "integer", required: true },
          { key: "days", label: l("Billable days", "الأيام القابلة للفوترة"), type: "integer", required: true },
          { key: "mobilisation", label: l("Priced mobilisation requested", "مطلوب تسعير التعبئة"), type: "boolean", default: true },
        ] }],
        lines: [
          { key: "service", group: "site", description: l("Meal service: {name}", "خدمة الوجبات: {name}"), quantity: "headcount * days", unit: "PERSON-DAY", block: "UNIT_PRICE" },
          { key: "mobilisation", group: "site", description: l("Mobilisation: {name}", "التعبئة: {name}"), quantity: "1", unit: "LS", block: "LUMP_SUM", when: "mobilisation == true" },
        ],
      },
      evaluation: { modes: ["weighted", "price", "manual"], mode: "weighted", scale: { min: 0, max: 5 }, criteria: [
        { key: "service_plan", label: l("Service plan", "خطة الخدمة") }, { key: "menu", label: l("Menu quality and variety", "جودة القوائم وتنوعها") }, { key: "experience", label: l("Experience and references", "الخبرة والمراجع") },
      ] },
      workflow: [],
    },
  },
  {
    meta: meta("CAT_FOOD_SUPPLY_RFQ", "RFQ", "FOOD_SUPPLY", ["Food supply RFQ", "طلب عرض سعر لتوريد الأغذية"], ["Supply of food items with delivery charges priced separately.", "توريد أصناف غذائية مع تسعير رسوم التوصيل بشكل منفصل."], "itemized"),
    version: 1, changeNote: "Initial release",
    content: {
      schema: 1, sections: [], documents: [companyProfileDoc(), { key: "product_specs", label: l("Product specifications", "مواصفات المنتجات"), purpose: l("Origin, grade and packaging of offered items.", "المنشأ والدرجة والتعبئة للأصناف المعروضة."), required: false, origin: "suggested", envelope: "technical", fileTypes: ["pdf", "xlsx"] }],
      fields: [
        { key: "delivery_frequency", section: "mobilisation", label: l("Delivery frequency", "تكرار التوصيل"), type: "single", source: "buyer", envelope: "technical", required: true,
          options: [{ key: "daily", label: l("Daily", "يوميًا") }, { key: "weekly", label: l("Weekly", "أسبوعيًا") }, { key: "monthly", label: l("Monthly", "شهريًا") }, { key: "on_demand", label: l("On demand", "عند الطلب") }] },
        { key: "min_shelf_life_days", section: "technical", label: l("Minimum remaining shelf life at delivery (days)", "الحد الأدنى لما تبقى من الصلاحية عند التسليم (بالأيام)"), type: "integer", source: "buyer", envelope: "technical", required: false },
        { key: "shelf_life_days", section: "technical", label: l("Shelf life you can guarantee at delivery (days)", "الصلاحية التي يمكنكم ضمانها عند التسليم (بالأيام)"), type: "integer", source: "supplier", envelope: "technical", required: true },
        offerValidity(), paymentTerms(), exclusionsField(),
      ],
      questions: [{ key: "cold_chain", section: "technical", label: l("Can you maintain the cold chain from storage to delivery?", "هل يمكنكم الحفاظ على سلسلة التبريد من التخزين إلى التسليم؟"), type: "yesno", use: "info", required: true }],
      pricing: {
        model: "itemized",
        groups: [{ key: "delivery", label: l("Delivery point", "نقطة التوصيل"), repeat: true, inputs: [{ key: "deliveries", label: l("Number of deliveries", "عدد التوصيلات"), type: "integer", required: true }] }],
        lines: [{ key: "delivery_charge", group: "delivery", description: l("Delivery charge: {name}", "رسوم التوصيل: {name}"), quantity: "deliveries", unit: "DELIVERY", block: "UNIT_PRICE", optional: true }],
      },
      evaluation: { modes: ["price", "weighted", "manual"], mode: "price", scale: { min: 0, max: 5 }, criteria: [{ key: "quality", label: l("Product quality", "جودة المنتجات") }, { key: "shelf_life", label: l("Shelf life", "مدة الصلاحية") }] },
      workflow: [],
    },
  },
  {
    meta: meta("CAT_KITCHEN_OPERATION_RFP", "RFP", "KITCHEN_OPERATION", ["Kitchen operation RFP", "طلب عرض لتشغيل المطبخ"], ["Operate a camp or site kitchen with named staffing roles priced by hour.", "تشغيل مطبخ معسكر أو موقع مع أدوار توظيف محددة بتسعير بالساعة."], "manpower"),
    version: 1, changeNote: "Initial release",
    content: {
      schema: 1, sections: [], documents: [companyProfileDoc()],
      fields: [
        { key: "operating_model", section: "service", label: l("Operating model", "نموذج التشغيل"), type: "single", source: "supplier", envelope: "technical", required: true,
          options: [{ key: "buyer_equipment", label: l("Using the buyer's equipment", "باستخدام معدات المشتري") }, { key: "own_equipment", label: l("Supplier brings equipment", "المورد يوفر المعدات") }] },
        { key: "shift_pattern", section: "service", label: l("Proposed shift pattern", "نمط الورديات المقترح"), type: "text", source: "supplier", envelope: "technical", required: true },
        offerValidity(), paymentTerms(), exclusionsField(),
      ],
      questions: [
        { key: "staffing_plan", section: "technical", label: l("Describe your staffing, supervision and training plan.", "صفوا خطة التوظيف والإشراف والتدريب."), type: "text", use: "scoring", required: true },
        referencesQuestion(),
      ],
      pricing: {
        model: "manpower",
        groups: [{ key: "role", label: l("Role", "الدور"), repeat: true, inputs: [
          { key: "staff", label: l("Number of staff", "عدد الموظفين"), type: "integer", required: true },
          { key: "hours", label: l("Normal hours per person", "ساعات العمل العادية لكل شخص"), type: "decimal", required: true },
          { key: "overtime_hours", label: l("Expected overtime hours per person", "ساعات العمل الإضافي المتوقعة لكل شخص"), type: "decimal", default: 0 },
        ] }],
        lines: [
          { key: "normal", group: "role", description: l("Normal hours: {name}", "الساعات العادية: {name}"), quantity: "staff * hours", unit: "HOUR", block: "UNIT_PRICE" },
          { key: "overtime", group: "role", description: l("Overtime hours: {name}", "ساعات العمل الإضافي: {name}"), quantity: "staff * overtime_hours", unit: "HOUR", block: "UNIT_PRICE", when: "overtime_hours > 0" },
          { key: "consumables", description: l("Consumables and cleaning supplies", "المستهلكات ومواد التنظيف"), quantity: "1", unit: "LS", block: "LUMP_SUM", optional: true },
        ],
      },
      evaluation: { modes: ["weighted", "manual"], mode: "weighted", scale: { min: 0, max: 5 }, criteria: [{ key: "staffing", label: l("Staffing and supervision", "التوظيف والإشراف") }, { key: "experience", label: l("Experience and references", "الخبرة والمراجع") }] },
      workflow: [],
    },
  },
];
