import type { TemplateSeed } from "../types";
import { companyProfileDoc, exclusionsField, l, leadTimeDays, offerValidity, paymentTerms, referencesQuestion, warrantyMonths, warrantyTerms } from "./common";

const meta = (key: string, eventType: "RFQ" | "RFP", category: string, title: [string, string], summary: [string, string], pricingModel: string) => ({
  key, kind: "scenario" as const, packCode: "AV_SYSTEMS", categoryCode: category, eventType, method: "invited", pricingModel, title: l(...title), summary: l(...summary), requires: ["rfx", "envelopes", "questionnaire", "line_pricing"],
});

export const AV: TemplateSeed[] = [
  {
    meta: meta("AV_EQUIPMENT_RFQ", "RFQ", "AV_SYSTEMS", ["AV equipment RFQ", "طلب عرض سعر معدات سمعية وبصرية"], ["Displays, audio, video conferencing, control and security equipment, with optional installation and maintenance priced separately.", "شاشات وصوتيات ومؤتمرات مرئية وأنظمة تحكم وأمن، مع تسعير التركيب والصيانة بشكل منفصل عند الطلب."], "itemized"),
    version: 1, changeNote: "Initial release",
    content: {
      schema: 1, sections: [], documents: [
        { key: "datasheets", label: l("Product datasheets", "الأوراق الفنية للمنتجات"), purpose: l("Shows the offered model meets the requested specification.", "تثبت أن الطراز المعروض يلبي المواصفات المطلوبة."), required: false, origin: "suggested", envelope: "technical", fileTypes: ["pdf"] },
        warrantyTerms(), companyProfileDoc(),
      ],
      fields: [
        { key: "delivery_site", section: "general", label: l("Delivery site", "موقع التسليم"), type: "text", source: "buyer", envelope: "technical", required: true },
        { key: "required_delivery_date", section: "general", label: l("Required delivery date", "تاريخ التسليم المطلوب"), type: "date", source: "buyer", envelope: "technical", required: false },
        { key: "brand", section: "equipment", label: l("Brand offered", "العلامة التجارية المعروضة"), type: "text", source: "supplier", envelope: "technical", required: true },
        { key: "model", section: "equipment", label: l("Model offered", "الطراز المعروض"), type: "text", source: "supplier", envelope: "technical", required: true },
        { key: "spec_compliance", section: "equipment", label: l("Compliance with the requested specification", "الامتثال للمواصفات المطلوبة"), type: "single", source: "supplier", envelope: "technical", required: true,
          options: [{ key: "compliant", label: l("Fully compliant", "مطابق بالكامل") }, { key: "deviation", label: l("Compliant with deviations", "مطابق مع انحرافات") }, { key: "non_compliant", label: l("Not compliant", "غير مطابق") }] },
        { key: "deviation_note", section: "equipment", label: l("Describe each deviation", "صفوا كل انحراف"), type: "longtext", source: "supplier", envelope: "technical", required: 'spec_compliance != "compliant"', visible: 'spec_compliance != "compliant"' },
        { key: "alternative_offered", section: "equipment", label: l("Are you offering an alternative to the requested item?", "هل تعرضون بديلًا للبند المطلوب؟"), type: "boolean", source: "supplier", envelope: "technical", required: false },
        { key: "alternative_note", section: "equipment", label: l("Describe the alternative and why it is equivalent", "صفوا البديل ولماذا هو مكافئ"), type: "longtext", source: "supplier", envelope: "technical", required: "alternative_offered == true", visible: "alternative_offered == true" },
        warrantyMonths(), leadTimeDays(), offerValidity(), paymentTerms(), exclusionsField(),
      ],
      questions: [],
      pricing: {
        model: "itemized",
        groups: [{ key: "maintenance", label: l("Maintenance", "الصيانة"), repeat: false, inputs: [{ key: "years", label: l("Maintenance years", "سنوات الصيانة"), type: "integer", required: true }] }],
        lines: [
          { key: "installation", description: l("Installation and commissioning", "التركيب والتشغيل"), quantity: "1", unit: "LS", block: "LUMP_SUM", optional: true },
          { key: "maintenance", group: "maintenance", description: l("Maintenance per year", "الصيانة السنوية"), quantity: "years", unit: "YEAR", block: "UNIT_PRICE", optional: true },
        ],
      },
      evaluation: { modes: ["price", "weighted", "manual"], mode: "price", scale: { min: 0, max: 5 }, criteria: [
        { key: "spec_compliance", label: l("Specification compliance", "الامتثال للمواصفات") }, { key: "warranty_support", label: l("Warranty and support", "الضمان والدعم") }, { key: "delivery", label: l("Delivery", "التسليم") },
      ] },
      workflow: [],
    },
  },
  {
    meta: meta("AV_INSTALLATION_RFP", "RFP", "AV_INSTALL", ["AV installation and commissioning RFP", "طلب عرض لتركيب وتشغيل الأنظمة السمعية والبصرية"], ["Design, install, test and commission an AV system, priced by milestone.", "تصميم وتركيب واختبار وتشغيل نظام سمعي وبصري بتسعير حسب المراحل."], "milestone"),
    version: 1, changeNote: "Initial release",
    content: {
      schema: 1, sections: [], documents: [
        { key: "method_statement", label: l("Method statement", "بيان الطريقة"), purpose: l("How the work will be carried out on site.", "كيف سينفذ العمل في الموقع."), required: false, origin: "suggested", envelope: "technical", fileTypes: ["pdf", "docx"] },
        { key: "project_plan", label: l("Project plan", "خطة المشروع"), purpose: l("Schedule with the milestones priced.", "الجدول الزمني مع المراحل المسعّرة."), required: false, origin: "suggested", envelope: "technical", fileTypes: ["pdf", "xlsx"] },
        warrantyTerms(), companyProfileDoc(),
      ],
      fields: [
        { key: "site_access_notes", section: "general", label: l("Site access and working hours", "الوصول إلى الموقع وساعات العمل"), type: "longtext", source: "buyer", envelope: "technical", required: false },
        { key: "installation_weeks", section: "service", label: l("Installation duration (weeks)", "مدة التركيب (بالأسابيع)"), type: "integer", source: "supplier", envelope: "technical", required: true },
        { key: "commissioning_support", section: "service", label: l("Commissioning and training included", "التشغيل والتدريب مشمولان"), type: "boolean", source: "supplier", envelope: "technical", required: true },
        warrantyMonths(), offerValidity(), paymentTerms(), exclusionsField(),
      ],
      questions: [
        { key: "method", section: "technical", label: l("Describe your installation method and quality checks.", "صفوا طريقة التركيب وفحوصات الجودة."), type: "text", use: "scoring", required: true },
        referencesQuestion(),
        { key: "subcontractors", section: "technical", label: l("Will any part of the work be subcontracted?", "هل سيُسند أي جزء من العمل إلى مقاولين من الباطن؟"), type: "yesno", use: "info", required: true },
      ],
      pricing: {
        model: "milestone",
        groups: [{ key: "milestone", label: l("Milestone", "المرحلة"), repeat: true, inputs: [] }],
        lines: [{ key: "milestone", group: "milestone", description: l("Milestone: {name}", "المرحلة: {name}"), quantity: "1", unit: "LS", block: "LUMP_SUM" }],
      },
      evaluation: { modes: ["weighted", "manual"], mode: "weighted", scale: { min: 0, max: 5 }, criteria: [
        { key: "method", label: l("Method and quality", "الطريقة والجودة") }, { key: "experience", label: l("Experience and references", "الخبرة والمراجع") }, { key: "schedule", label: l("Schedule", "الجدول الزمني") }, { key: "warranty", label: l("Warranty", "الضمان") },
      ] },
      workflow: [],
    },
  },
  {
    meta: meta("AV_MAINTENANCE_RFP", "RFP", "MAINTENANCE_SERVICE", ["AV maintenance RFP", "طلب عرض لصيانة الأنظمة السمعية والبصرية"], ["Recurring maintenance and support for installed AV systems, priced per unit and period.", "صيانة ودعم دوريان لأنظمة سمعية وبصرية قائمة بتسعير لكل وحدة وفترة."], "subscription"),
    version: 1, changeNote: "Initial release",
    content: {
      schema: 1, sections: [], documents: [
        { key: "sla", label: l("Service level proposal", "مقترح مستوى الخدمة"), purpose: l("Response and restoration targets you commit to.", "أهداف الاستجابة والإصلاح التي تلتزمون بها."), required: false, origin: "suggested", envelope: "technical", fileTypes: ["pdf", "docx"] },
        companyProfileDoc(),
      ],
      fields: [
        { key: "support_hours", section: "service", label: l("Support hours offered", "ساعات الدعم المعروضة"), type: "single", source: "supplier", envelope: "technical", required: true,
          options: [{ key: "business", label: l("Business hours", "ساعات العمل") }, { key: "extended", label: l("Extended hours", "ساعات ممتدة") }, { key: "24x7", label: l("24 hours, 7 days", "على مدار الساعة طوال الأسبوع") }] },
        { key: "response_hours", section: "service", label: l("Target response time (hours)", "زمن الاستجابة المستهدف (بالساعات)"), type: "integer", source: "supplier", envelope: "technical", required: true },
        { key: "restoration_hours", section: "service", label: l("Target restoration time (hours)", "زمن الإصلاح المستهدف (بالساعات)"), type: "integer", source: "supplier", envelope: "technical", required: true },
        { key: "spares_included", section: "service", label: l("Spare parts included", "قطع الغيار مشمولة"), type: "boolean", source: "supplier", envelope: "technical", required: true },
        offerValidity(), paymentTerms(), exclusionsField(),
      ],
      questions: [
        { key: "service_model", section: "technical", label: l("Describe how you will deliver the maintenance service.", "صفوا كيف ستقدمون خدمة الصيانة."), type: "text", use: "scoring", required: true },
        referencesQuestion(),
      ],
      pricing: {
        model: "subscription",
        groups: [{ key: "coverage", label: l("Covered site", "الموقع المشمول"), repeat: true, inputs: [
          { key: "units", label: l("Systems or rooms covered", "الأنظمة أو القاعات المشمولة"), type: "integer", required: true },
          { key: "months", label: l("Months of service", "أشهر الخدمة"), type: "integer", required: true },
        ] }],
        lines: [
          { key: "recurring", group: "coverage", description: l("Maintenance: {name}", "الصيانة: {name}"), quantity: "units * months", unit: "UNIT-MONTH", block: "UNIT_PRICE" },
          { key: "onboarding", description: l("One-time onboarding and asset survey", "التهيئة الأولية ومسح الأصول (مرة واحدة)"), quantity: "1", unit: "LS", block: "LUMP_SUM", optional: true },
        ],
      },
      evaluation: { modes: ["weighted", "manual"], mode: "weighted", scale: { min: 0, max: 5 }, criteria: [
        { key: "service_model", label: l("Service model", "نموذج الخدمة") }, { key: "response", label: l("Response and restoration", "الاستجابة والإصلاح") }, { key: "experience", label: l("Experience and references", "الخبرة والمراجع") },
      ] },
      workflow: [],
    },
  },
];
