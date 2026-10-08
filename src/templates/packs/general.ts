import type { TemplateSeed } from "../types";
import { companyProfileDoc, exclusionsField, l, leadTimeDays, offerValidity, paymentTerms, referencesQuestion } from "./common";

const meta = (key: string, eventType: "RFI" | "RFQ" | "RFP", title: [string, string], summary: [string, string], pricingModel: string) => ({
  key, kind: "general" as const, packCode: null, categoryCode: "GENERAL", eventType, method: "invited", pricingModel, title: l(...title), summary: l(...summary), requires: ["rfx", "envelopes", "questionnaire"],
});
const noPricing = { model: "none" as const, groups: [], lines: [] };

export const GENERAL: TemplateSeed[] = [
  {
    meta: meta("GEN_RFQ", "RFQ", ["General RFQ", "طلب عرض سعر عام"], ["Price a list of items from several suppliers.", "تسعير قائمة بنود من عدة موردين."], "itemized"),
    version: 1, changeNote: "Initial release",
    content: {
      schema: 1, sections: [], questions: [], documents: [companyProfileDoc()],
      fields: [leadTimeDays(), offerValidity(), paymentTerms(), exclusionsField()],
      pricing: { model: "itemized", groups: [], lines: [] },
      evaluation: { modes: ["price", "weighted", "manual"], mode: "price", scale: { min: 0, max: 5 }, criteria: [] },
      workflow: [],
    },
  },
  {
    meta: meta("GEN_RFP", "RFP", ["General RFP", "طلب عرض عام"], ["Ask for a proposal and compare approach and price.", "طلب مقترح ومقارنة الأسلوب والسعر."], "mixed"),
    version: 1, changeNote: "Initial release",
    content: {
      schema: 1, sections: [], documents: [companyProfileDoc()],
      fields: [leadTimeDays(), offerValidity(), paymentTerms(), exclusionsField()],
      questions: [
        { key: "approach", section: "technical", label: l("Describe your approach and work plan.", "صفوا أسلوبكم وخطة العمل."), type: "text", use: "scoring", required: true },
        referencesQuestion(),
        { key: "team", section: "technical", label: l("Who will do the work, and what is their experience?", "من سيتولى العمل وما خبرتهم؟"), type: "text", use: "scoring", required: true },
      ],
      pricing: { model: "itemized", groups: [], lines: [] },
      evaluation: { modes: ["weighted", "manual"], mode: "weighted", scale: { min: 0, max: 5 }, criteria: [
        { key: "approach", label: l("Approach and work plan", "الأسلوب وخطة العمل") }, { key: "experience", label: l("Experience and references", "الخبرة والمراجع") }, { key: "team", label: l("Team", "فريق العمل") },
      ] },
      workflow: [],
    },
  },
  {
    meta: meta("GEN_RFI", "RFI", ["General RFI", "طلب معلومات عام"], ["Learn what the market offers. No prices are requested.", "التعرف على ما يقدمه السوق دون طلب أسعار."], "none"),
    version: 1, changeNote: "Initial release",
    content: {
      schema: 1, sections: [], documents: [companyProfileDoc()], fields: [],
      questions: [
        { key: "capability", section: "technical", label: l("Describe what you can offer for this need.", "صفوا ما يمكنكم تقديمه لهذه الحاجة."), type: "text", use: "info", required: true },
        referencesQuestion(),
        { key: "indicative_timeline", section: "technical", label: l("What is a realistic timeline?", "ما الجدول الزمني الواقعي؟"), type: "text", use: "info", required: false },
      ],
      pricing: noPricing,
      evaluation: { modes: ["qualification", "manual"], mode: "manual", scale: { min: 0, max: 5 }, criteria: [] },
      workflow: [],
    },
  },
];
