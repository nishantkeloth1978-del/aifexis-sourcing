import type { DocumentReq, Field, L, Question, Section } from "../types";

export const l = (en: string, ar: string): L => ({ en, ar });

export const SEC = {
  general: { key: "general", label: l("General", "عام") } as Section,
  technical: { key: "technical", label: l("Technical response", "الرد الفني") } as Section,
  commercial: { key: "commercial", label: l("Commercial response", "الرد التجاري") } as Section,
  equipment: { key: "equipment", label: l("Equipment offered", "المعدات المعروضة") } as Section,
  service: { key: "service", label: l("Service approach", "أسلوب تقديم الخدمة") } as Section,
  warranty: { key: "warranty", label: l("Warranty and support", "الضمان والدعم") } as Section,
  mobilisation: { key: "mobilisation", label: l("Mobilisation and delivery", "التعبئة والتسليم") } as Section,
};

/** Components reused by several packs. */
export const warrantyMonths = (): Field => ({ key: "warranty_months", section: "warranty", label: l("Warranty period (months)", "مدة الضمان (بالأشهر)"), type: "integer", source: "supplier", envelope: "technical", required: true });
export const warrantyTerms = (): DocumentReq => ({ key: "warranty_terms", label: l("Warranty terms", "شروط الضمان"), purpose: l("What the warranty covers and excludes.", "ما يغطيه الضمان وما يستثنيه."), required: false, origin: "suggested", envelope: "technical", fileTypes: ["pdf", "docx"] });
export const leadTimeDays = (): Field => ({ key: "lead_time_days", section: "mobilisation", label: l("Delivery or start lead time (days)", "مدة التسليم أو البدء (بالأيام)"), type: "integer", source: "supplier", envelope: "technical", required: true });
export const offerValidity = (): Field => ({ key: "offer_validity_days", section: "commercial", label: l("Offer validity (days)", "مدة صلاحية العرض (بالأيام)"), type: "integer", source: "supplier", envelope: "commercial", required: true });
export const paymentTerms = (): Field => ({ key: "payment_terms", section: "commercial", label: l("Payment terms proposed", "شروط الدفع المقترحة"), type: "text", source: "supplier", envelope: "commercial", required: false });
export const companyProfileDoc = (): DocumentReq => ({ key: "company_profile", label: l("Company profile", "نبذة عن الشركة"), purpose: l("Who you are and what you have delivered.", "من أنتم وما الذي أنجزتموه."), required: false, origin: "suggested", envelope: "technical", fileTypes: ["pdf", "docx"] });
export const referencesQuestion = (): Question => ({ key: "references", section: "technical", label: l("Describe two similar projects you have delivered.", "صفوا مشروعين مشابهين نفذتموهما."), type: "text", use: "scoring", required: true });
export const exclusionsField = (): Field => ({ key: "exclusions", section: "commercial", label: l("Exclusions and assumptions", "الاستثناءات والافتراضات"), type: "longtext", source: "supplier", envelope: "commercial", required: false });
