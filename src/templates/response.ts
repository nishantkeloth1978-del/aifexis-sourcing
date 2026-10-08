import { evaluate, parse, type Env } from "./expr";
import type { DocumentReq, Effective, Field, L, Option, Question } from "./types";

/** One thing a supplier is asked, flattened from fields and questions. */
export interface Ask {
  key: string; label: L; type: "text" | "longtext" | "integer" | "decimal" | "money" | "date" | "boolean" | "single" | "multi" | "yesno";
  options?: Option[]; envelope: "technical" | "commercial"; required: boolean | string; visible?: string; section: string; help?: L;
}
export interface SupplierView { buyerFields: { key: string; label: L; type: Field["type"]; options?: Option[]; value: string }[]; asks: Ask[]; documents: DocumentReq[]; sections: { key: string; label: L }[] }

export type Answers = Record<string, string | boolean | string[]>;
const asFieldType = (q: Question): Ask["type"] => (q.type === "number" ? "decimal" : q.type);

/**
 * What a supplier sees of the issued configuration: the buyer's stated requirements, the supplier questions and the document list.
 * Evaluation criteria, workflow and internal mappings are not included. Yes/No qualification questions are asked as the event's declarations instead.
 */
export function supplierView(e: Effective, buyerValues: Record<string, unknown> = {}): SupplierView {
  const asks: Ask[] = [];
  for (const f of e.fields) if (f.source === "supplier") asks.push({ key: f.key, label: f.label, type: f.type, options: f.options, envelope: f.envelope, required: f.required ?? false, visible: f.visible, section: f.section, help: f.help });
  for (const q of e.questions) if (!(q.use === "qualification" && q.type === "yesno")) asks.push({ key: q.key, label: q.label, type: asFieldType(q), options: q.options, envelope: "technical", required: q.required, section: q.section });
  const used = new Set([...asks.map((a) => a.section), ...e.fields.filter((f) => f.source === "buyer").map((f) => f.section), "general"]);
  return {
    buyerFields: e.fields.filter((f) => f.source === "buyer").map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options, value: formatBuyerValue(f, buyerValues[f.key]) })).filter((f) => f.value !== ""),
    asks, documents: e.documents, sections: e.sections.filter((s) => used.has(s.key)),
  };
}
const formatBuyerValue = (f: Field, v: unknown): string => {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v.map((x) => f.options?.find((o) => o.key === x)?.label.en ?? String(x)).join(", ");
  if (f.type === "single") return f.options?.find((o) => o.key === v)?.label.en ?? String(v);
  return String(v);
};

const envOf = (a: Answers): Env => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v]));
export const isVisible = (a: Ask, answers: Answers): boolean => { if (!a.visible) return true; try { return evaluate(parse(a.visible), envOf(answers)) !== false; } catch { return true; } };
export const isRequired = (a: Ask, answers: Answers): boolean => {
  if (typeof a.required === "boolean") return a.required;
  try { return evaluate(parse(a.required), envOf(answers)) === true; } catch { return false; }
};

export type Checked = { ok: true; technical: Answers; commercial: Answers } | { ok: false; error: string; key: string; label?: L };

/** Validates a supplier's answers against the issued questions. Required conditions are evaluated over the answers. A zero stays 0. */
export function checkAnswers(view: SupplierView, raw: Record<string, unknown>): Checked {
  const out: Answers = {};
  for (const a of view.asks) {
    if (!isVisible(a, out as Answers) && !isVisible(a, normalise(raw))) continue;
    const v = raw[a.key];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    const answers = { ...normalise(raw) };
    if (empty) { if (isRequired(a, answers)) return { ok: false, error: "Answer: {0}.", key: a.key, label: a.label }; continue; }
    const bad = (): Checked => ({ ok: false, error: "The answer to {0} is not valid.", key: a.key, label: a.label });
    switch (a.type) {
      case "text": if (typeof v !== "string" || v.length > 500) return bad(); out[a.key] = v.trim(); break;
      case "longtext": if (typeof v !== "string" || v.length > 5000) return bad(); out[a.key] = v.trim(); break;
      case "integer": if (!/^\d{1,9}$/.test(String(v))) return bad(); out[a.key] = String(v); break;
      case "decimal": if (!/^\d{1,12}(\.\d{1,3})?$/.test(String(v))) return bad(); out[a.key] = String(v); break;
      case "money": if (!/^\d{1,12}(\.\d{1,2})?$/.test(String(v))) return bad(); out[a.key] = String(v); break;
      case "date": if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(String(v)))) return bad(); out[a.key] = String(v); break;
      case "boolean": case "yesno": if (typeof v !== "boolean" && v !== "true" && v !== "false") return bad(); out[a.key] = v === true || v === "true"; break;
      case "single": if (typeof v !== "string" || !a.options?.some((o) => o.key === v)) return bad(); out[a.key] = v; break;
      case "multi": if (!Array.isArray(v) || v.some((x) => !a.options?.some((o) => o.key === x))) return bad(); out[a.key] = [...new Set(v.map(String))]; break;
    }
  }
  const technical: Answers = {}, commercial: Answers = {};
  for (const a of view.asks) if (a.key in out) (a.envelope === "commercial" ? commercial : technical)[a.key] = out[a.key]!;
  return { ok: true, technical, commercial };
}
function normalise(raw: Record<string, unknown>): Answers {
  const o: Answers = {};
  for (const [k, v] of Object.entries(raw)) { if (v === "true") o[k] = true; else if (v === "false") o[k] = false; else if (typeof v === "string" || typeof v === "boolean") o[k] = v; else if (Array.isArray(v)) o[k] = v.map(String); }
  return o;
}

/** Readable "Label: answer" lines, for evaluators and the award pack. */
export function answerLines(view: SupplierView, answers: Answers, locale: "en" | "ar" = "en"): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const a of view.asks) {
    if (!(a.key in answers)) continue;
    const v = answers[a.key]!;
    const text = Array.isArray(v) ? v.map((x) => a.options?.find((o) => o.key === x)?.label[locale] ?? x).join(", ") : typeof v === "boolean" ? (v ? (locale === "ar" ? "نعم" : "Yes") : (locale === "ar" ? "لا" : "No")) : a.type === "single" ? a.options?.find((o) => o.key === v)?.label[locale] ?? String(v) : String(v);
    out.push({ label: a.label[locale] || a.label.en, value: text });
  }
  return out;
}
