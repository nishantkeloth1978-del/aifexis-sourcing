import type { DocumentReq, Field, FieldType, PriceGroup, PriceLine, Question, TemplateSeed } from "../types";
import { companyProfileDoc, exclusionsField, l, leadTimeDays, offerValidity, paymentTerms, referencesQuestion } from "./common";

type Pair = [string, string];
/** Short constructors so each pack reads as content rather than plumbing. */
export const buyer = (key: string, section: string, label: Pair, type: FieldType, required: boolean, extra: Partial<Field> = {}): Field => ({ key, section, label: l(...label), type, source: "buyer", envelope: "technical", required, ...extra });
export const supplier = (key: string, section: string, label: Pair, type: FieldType, required: boolean, extra: Partial<Field> = {}): Field => ({ key, section, label: l(...label), type, source: "supplier", envelope: "technical", required, ...extra });
export const opts = (...o: [string, string, string][]) => o.map(([key, en, ar]) => ({ key, label: l(en, ar) }));
export const doc = (key: string, label: Pair, purpose: Pair, fileTypes = ["pdf"]): DocumentReq => ({ key, label: l(...label), purpose: l(...purpose), required: false, origin: "suggested", envelope: "technical", fileTypes });
export const yesno = (key: string, label: Pair, use: "info" | "qualification" = "info", required = true): Question => ({ key, section: "technical", label: l(...label), type: "yesno", use, required });
export const ask = (key: string, label: Pair, use: "info" | "scoring" = "scoring", required = true): Question => ({ key, section: "technical", label: l(...label), type: "text", use, required });
export const input = (key: string, label: Pair, type: "integer" | "decimal" | "text" | "boolean", required = true, def?: string | number | boolean) => ({ key, label: l(...label), type, ...(required ? { required: true } : {}), ...(def !== undefined ? { default: def } : {}) });
export const group = (key: string, label: Pair, inputs: ReturnType<typeof input>[], repeat = true): PriceGroup => ({ key, label: l(...label), repeat, inputs });
export const line = (key: string, description: Pair, quantity: string, unit: string, block: "UNIT_PRICE" | "LUMP_SUM" = "UNIT_PRICE", extra: Partial<PriceLine> = {}): PriceLine => ({ key, description: l(...description), quantity, unit, block, ...extra });

export interface Spec {
  key: string; type: "RFQ" | "RFP"; category: string; title: Pair; summary: Pair; model: "itemized" | "person_day" | "manpower" | "subscription" | "milestone" | "freight" | "mixed";
  fields?: Field[]; questions?: Question[]; documents?: DocumentReq[]; groups?: PriceGroup[]; lines?: PriceLine[]; criteria?: [string, string, string][]; leadTime?: boolean;
}
const RFP_CRITERIA: [string, string, string][] = [["approach", "Approach and work plan", "الأسلوب وخطة العمل"], ["experience", "Experience and references", "الخبرة والمراجع"]];

export function pack(code: string, specs: Spec[]): TemplateSeed[] {
  return specs.map((s) => {
    const rfp = s.type === "RFP";
    const criteria = s.criteria ?? (rfp ? RFP_CRITERIA : []);
    const questions = [...(s.questions ?? []), ...(rfp && !(s.questions ?? []).some((q) => q.key === "approach") ? [ask("approach", ["Describe your approach and work plan.", "صفوا أسلوبكم وخطة العمل."])] : []), ...(rfp ? [referencesQuestion()] : [])];
    return {
      meta: { key: s.key, kind: "scenario" as const, packCode: code, categoryCode: s.category, eventType: s.type, method: "invited", pricingModel: s.model, title: l(...s.title), summary: l(...s.summary), requires: ["rfx", "envelopes", "questionnaire", "line_pricing"] },
      version: 1, changeNote: "Initial release",
      content: {
        schema: 1 as const, sections: [], documents: [companyProfileDoc(), ...(s.documents ?? [])],
        fields: [...(s.fields ?? []), ...(s.leadTime ? [leadTimeDays()] : []), offerValidity(), paymentTerms(), exclusionsField()],
        questions,
        pricing: { model: s.model, groups: s.groups ?? [], lines: s.lines ?? [] },
        evaluation: { modes: rfp ? ["weighted", "price", "manual"] as ("weighted" | "price" | "manual")[] : ["price", "weighted", "manual"] as ("weighted" | "price" | "manual")[], mode: rfp ? "weighted" as const : "price" as const, scale: { min: 0, max: 5 }, criteria: criteria.map(([key, en, ar]) => ({ key, label: l(en, ar) })) },
        workflow: [],
      },
    };
  });
}
