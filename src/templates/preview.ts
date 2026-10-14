import type { Cond, Envelope, FieldType, L, TemplateContent } from "./types";

/** Read-only summary of what a template contains, for the hover card. Pure: no database, safe to import anywhere. */
export type Need = "required" | "optional" | "conditional";
export interface PreviewRow { label: L; need: Need; envelope?: Envelope; note?: string; section?: L }
export interface TemplatePreview {
  key: string; title: L; summary: L; eventType: string; version: number;
  counts: { fields: number; questions: number; documents: number; lines: number; criteria: number };
  envelopes: 1 | 2;
  fields: (PreviewRow & { type: FieldType })[];
  questions: (PreviewRow & { use: "info" | "qualification" | "scoring"; type: string })[];
  documents: (PreviewRow & { fileTypes: string[]; expiry: boolean; purpose: L })[];
  pricing: { model: string; groups: { label: L; inputs: L[]; repeat: boolean }[]; lines: { label: L; how: "unit" | "lump"; optional: boolean; unit: string }[] };
  evaluation: { mode: string; modes: string[]; scale: { min: number; max: number }; criteria: L[] };
}

const need = (r: boolean | Cond | undefined): Need => (r === true ? "required" : typeof r === "string" && r.trim() ? "conditional" : "optional");

export function buildPreview(meta: { key: string; title: L; summary: L; eventType: string; version: number }, c: TemplateContent): TemplatePreview {
  const sec = new Map(c.sections.map((s) => [s.key, s.label]));
  const fields = c.fields.filter((f) => f.source === "buyer").map((f) => ({ label: f.label, need: need(f.required), type: f.type, envelope: f.envelope, section: sec.get(f.section) }));
  const supplierFields = c.fields.filter((f) => f.source === "supplier").map((f) => ({ label: f.label, need: need(f.required), use: "info" as const, type: f.type, envelope: f.envelope, section: sec.get(f.section) }));
  const questions = [...c.questions.map((q) => ({ label: q.label, need: need(q.required), use: q.use, type: q.type, envelope: "technical" as Envelope | undefined, section: sec.get(q.section), note: q.evidence ? "evidence" : undefined })), ...supplierFields];
  const envelopes: 1 | 2 = new Set([...c.fields.map((f) => f.envelope), ...c.documents.map((d) => d.envelope), ...(c.pricing.lines.length ? ["commercial"] : [])]).size > 1 || c.pricing.lines.length ? 2 : 1;
  return {
    key: meta.key, title: meta.title, summary: meta.summary, eventType: meta.eventType, version: meta.version,
    counts: { fields: fields.length, questions: questions.length, documents: c.documents.length, lines: c.pricing.lines.length, criteria: c.evaluation.criteria.length },
    envelopes, fields, questions,
    documents: c.documents.map((d) => ({ label: d.label, purpose: d.purpose, need: need(d.required), envelope: d.envelope, fileTypes: d.fileTypes, expiry: d.expiry === true })),
    pricing: {
      model: c.pricing.model,
      groups: c.pricing.groups.map((g) => ({ label: g.label, repeat: g.repeat, inputs: g.inputs.map((i) => i.label) })),
      lines: c.pricing.lines.map((l) => ({ label: l.description, how: l.block === "LUMP_SUM" ? "lump" : "unit", optional: l.optional === true, unit: l.unit })),
    },
    evaluation: { mode: c.evaluation.mode, modes: c.evaluation.modes, scale: c.evaluation.scale, criteria: c.evaluation.criteria.map((k) => k.label) },
  };
}
