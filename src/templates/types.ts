/** Typed template content. Everything is addressed by a stable `key`; labels and order never carry meaning. */
export interface L { en: string; ar: string }
export type FieldType = "text" | "longtext" | "integer" | "decimal" | "money" | "date" | "boolean" | "single" | "multi";
export type Envelope = "technical" | "commercial";
export type Cond = string;                                   // restricted expression, see expr.ts

export interface Section { key: string; label: L }
export interface Option { key: string; label: L }
export interface Field {
  key: string; section: string; label: L; type: FieldType;
  source: "buyer" | "supplier"; envelope: Envelope;
  required?: boolean | Cond; visible?: Cond; default?: string | number | boolean;
  options?: Option[]; help?: L;
}
export interface Question {
  key: string; section: string; label: L; type: "yesno" | "text" | "single" | "multi" | "number" | "date";
  options?: Option[]; use: "info" | "qualification" | "scoring";
  required: boolean | Cond; evidence?: boolean;
}
export interface DocumentReq {
  key: string; label: L; purpose: L; required: boolean | Cond; origin: "suggested" | "company";
  envelope: Envelope; fileTypes: string[]; expiry?: boolean;
}
/** One input of a repeating group (a site, a role, a lane, a milestone). */
export interface PriceInput { key: string; label: L; type: "integer" | "decimal" | "text" | "boolean"; required?: boolean; default?: string | number | boolean }
export interface PriceGroup { key: string; label: L; repeat: boolean; inputs: PriceInput[] }
/** A line the schedule builder creates. `quantity` is an arithmetic expression over the group's inputs. */
export interface PriceLine {
  key: string; group?: string; description: L; quantity: string; unit: string; block: "UNIT_PRICE" | "LUMP_SUM";
  when?: Cond; optional?: boolean;
}
export interface Pricing { model: "itemized" | "person_day" | "manpower" | "subscription" | "milestone" | "freight" | "mixed" | "none"; groups: PriceGroup[]; lines: PriceLine[] }
export interface Criterion { key: string; label: L }
export interface Evaluation { modes: ("qualification" | "price" | "weighted" | "manual")[]; mode: "qualification" | "price" | "weighted" | "manual"; scale: { min: number; max: number }; criteria: Criterion[] }
export interface WorkflowStep { key: string; action: string; owner: string; cond?: Cond }

export interface TemplateContent {
  schema: 1;
  sections: Section[]; fields: Field[]; questions: Question[]; documents: DocumentReq[];
  pricing: Pricing; evaluation: Evaluation; workflow: WorkflowStep[];
}
export type Collection = "sections" | "fields" | "questions" | "documents" | "criteria" | "lines";
export const COLLECTIONS: Collection[] = ["sections", "fields", "questions", "documents", "criteria", "lines"];

/** What this deployment can actually run. A template that requires more cannot be enabled. */
export const DEPLOYED_CAPABILITIES = ["rfx", "envelopes", "weighted_evaluation", "line_pricing", "lots", "questionnaire", "handover"] as const;
export type Capability = (typeof DEPLOYED_CAPABILITIES)[number] | "auction" | "public_publishing";
export const CAPABILITY_LABEL: Record<string, string> = {
  auction: "Reverse auction", public_publishing: "Public tender publishing",
};

export type Source = "base" | "template" | "company" | "event";
export interface Effective extends TemplateContent { provenance: Record<string, Source> }   // key "collection:objectKey"

export interface OverrideOp { collection: Collection; objectKey: string; op: "add" | "update" | "remove"; value?: Record<string, unknown>; scope?: string }

export interface TemplateMeta {
  key: string; kind: "general" | "scenario"; packCode: string | null; categoryCode: string; eventType: "RFI" | "RFQ" | "RFP";
  method: string; pricingModel: string; title: L; summary: L; requires: string[];
}
export interface TemplateSeed { meta: TemplateMeta; version: number; changeNote: string; content: TemplateContent }

export const lbl = (l: L, locale: "en" | "ar") => (locale === "ar" && l.ar ? l.ar : l.en);
