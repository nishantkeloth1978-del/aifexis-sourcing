import type { TemplateSeed } from "../types";
import { AV } from "./av";
import { CATERING } from "./catering";
import { GENERAL } from "./general";
import { CONSTRUCTION, FACILITIES, HEALTHCARE, IT, LOGISTICS, MANUFACTURING, OILGAS, STAFFING } from "./more";

export interface PackSeed { code: string; en: string; ar: string; industryCodes: string[] }
/** Stage 1 content, seeded by migration 0019. Do not change it: new content goes in the next release. */
export const PACKS_1: PackSeed[] = [
  { code: "AV_SYSTEMS", en: "AV and system integration", ar: "الأنظمة السمعية والبصرية وتكامل الأنظمة", industryCodes: ["AV_SECURITY"] },
  { code: "CATERING_PACK", en: "Catering and offshore services", ar: "التموين والخدمات البحرية", industryCodes: ["CATERING"] },
];
export const TEMPLATES_1: TemplateSeed[] = [...GENERAL, ...AV, ...CATERING];

/** Stage 2 content, seeded by migration 0020. */
export const PACKS_2: PackSeed[] = [
  { code: "CONSTRUCTION_PACK", en: "Construction and infrastructure", ar: "الإنشاءات والبنية التحتية", industryCodes: ["CONSTRUCTION"] },
  { code: "STAFFING_PACK", en: "Staffing and manpower", ar: "التوظيف وتوريد العمالة", industryCodes: ["STAFFING"] },
  { code: "FACILITIES_PACK", en: "Facilities management", ar: "إدارة المرافق", industryCodes: ["FACILITIES"] },
  { code: "MANUFACTURING_PACK", en: "Manufacturing", ar: "التصنيع", industryCodes: ["MANUFACTURING"] },
  { code: "OILGAS_PACK", en: "Oil and gas", ar: "النفط والغاز", industryCodes: ["OIL_GAS"] },
  { code: "LOGISTICS_PACK", en: "Logistics and warehousing", ar: "الخدمات اللوجستية والتخزين", industryCodes: ["LOGISTICS"] },
  { code: "HEALTHCARE_PACK", en: "Healthcare", ar: "الرعاية الصحية", industryCodes: ["HEALTHCARE"] },
  { code: "IT_PACK", en: "IT and software", ar: "تقنية المعلومات والبرمجيات", industryCodes: ["IT_SOFTWARE"] },
];
export const TEMPLATES_2: TemplateSeed[] = [...CONSTRUCTION, ...STAFFING, ...FACILITIES, ...MANUFACTURING, ...OILGAS, ...LOGISTICS, ...HEALTHCARE, ...IT];

export const PACKS: PackSeed[] = [...PACKS_1, ...PACKS_2];
export const ALL_TEMPLATES: TemplateSeed[] = [...TEMPLATES_1, ...TEMPLATES_2];
