import type { TemplateSeed } from "../types";
import { AV } from "./av";
import { CATERING } from "./catering";
import { GENERAL } from "./general";

export interface PackSeed { code: string; en: string; ar: string; industryCodes: string[] }
export const PACKS: PackSeed[] = [
  { code: "AV_SYSTEMS", en: "AV and system integration", ar: "الأنظمة السمعية والبصرية وتكامل الأنظمة", industryCodes: ["AV_SECURITY"] },
  { code: "CATERING_PACK", en: "Catering and offshore services", ar: "التموين والخدمات البحرية", industryCodes: ["CATERING"] },
];
export const ALL_TEMPLATES: TemplateSeed[] = [...GENERAL, ...AV, ...CATERING];
