import type { Pool } from "pg";
import { audit, withTenant } from "@/authz";
import type { Who } from "@/events/service";
import { hashOf, resolve } from "./resolve";
import { validateEffective, type Issue } from "./validate";
import { allTemplates, type TOut } from "./service";
import { DEPLOYED_CAPABILITIES, type TemplateContent } from "./types";

const ADMIN = new Set(["admin"]);
const err = (error: string, issues?: Issue[]): { ok: false; error: string; issues?: Issue[] } => ({ ok: false, error, ...(issues ? { issues } : {}) });
const KEY = /^[a-z0-9_]{1,80}$/;
const MAX_BYTES = 200_000;

type Bad = { path: string; message: string };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isL = (v: unknown) => isObj(v) && str(v.en, 400) && str(v.ar, 400);
const oneOf = (v: unknown, list: readonly string[]) => typeof v === "string" && list.includes(v);
const FIELD_TYPES = ["text", "longtext", "integer", "decimal", "money", "date", "boolean", "single", "multi"];
const Q_TYPES = ["yesno", "text", "single", "multi", "number", "date"];
const PRICING = ["itemized", "person_day", "manpower", "subscription", "milestone", "freight", "mixed", "none"];
const reqOk = (v: unknown) => v === undefined || typeof v === "boolean" || (typeof v === "string" && v.length <= 300);

/** Checks the shape of imported content and keeps only known properties. Meaning (references, cycles, leaks) is checked by validateEffective afterwards. */
export function sanitise(raw: unknown): { ok: true; content: TemplateContent } | { ok: false; problems: Bad[] } {
  const bad: Bad[] = [];
  if (!isObj(raw)) return { ok: false, problems: [{ path: "content", message: "The content must be an object." }] };
  const arr = (name: string): Record<string, unknown>[] => { const v = raw[name]; if (v === undefined) return []; if (!Array.isArray(v) || v.length > 300) { bad.push({ path: name, message: "Must be a list of at most 300 items." }); return []; } return v.filter(isObj); };
  const opts = (o: unknown, p: string) => { if (o === undefined) return undefined; if (!Array.isArray(o) || o.length > 100 || !o.every((x) => isObj(x) && typeof x.key === "string" && KEY.test(x.key) && isL(x.label))) { bad.push({ path: p, message: "Options need a key and an English and Arabic label." }); return undefined; } return (o as { key: string; label: { en: string; ar: string } }[]).map((x) => ({ key: x.key, label: { en: x.label.en, ar: x.label.ar } })); };
  const sections = arr("sections").map((s, i) => { if (!(typeof s.key === "string" && KEY.test(s.key) && isL(s.label))) bad.push({ path: `sections[${i}]`, message: "A section needs a key and an English and Arabic label." }); return { key: String(s.key), label: s.label as { en: string; ar: string } }; });
  const fields = arr("fields").map((f, i) => {
    const p = `fields[${i}]`;
    if (!(typeof f.key === "string" && KEY.test(f.key) && isL(f.label) && oneOf(f.type, FIELD_TYPES) && oneOf(f.source, ["buyer", "supplier"]) && oneOf(f.envelope, ["technical", "commercial"]) && typeof f.section === "string" && reqOk(f.required) && (f.visible === undefined || str(f.visible, 300)))) bad.push({ path: p, message: "Check key, label, type, source, envelope, section and conditions." });
    return { key: String(f.key), section: String(f.section), label: f.label, type: f.type, source: f.source, envelope: f.envelope, ...(f.required !== undefined ? { required: f.required } : {}), ...(f.visible ? { visible: f.visible } : {}), ...(f.default !== undefined && ["string", "number", "boolean"].includes(typeof f.default) ? { default: f.default } : {}), ...(opts(f.options, p + ".options") ? { options: opts(f.options, p) } : {}), ...(isL(f.help) ? { help: f.help } : {}) };
  });
  const questions = arr("questions").map((q, i) => {
    if (!(typeof q.key === "string" && KEY.test(q.key) && isL(q.label) && oneOf(q.type, Q_TYPES) && oneOf(q.use, ["info", "qualification", "scoring"]) && typeof q.section === "string" && typeof q.required !== "undefined" && reqOk(q.required))) bad.push({ path: `questions[${i}]`, message: "Check key, label, type, use, section and required." });
    return { key: String(q.key), section: String(q.section), label: q.label, type: q.type, use: q.use, required: q.required ?? false, ...(opts(q.options, `questions[${i}].options`) ? { options: opts(q.options, `questions[${i}]`) } : {}), ...(q.evidence === true ? { evidence: true } : {}) };
  });
  const documents = arr("documents").map((d, i) => {
    if (!(typeof d.key === "string" && KEY.test(d.key) && isL(d.label) && isL(d.purpose) && reqOk(d.required) && oneOf(d.envelope, ["technical", "commercial"]) && Array.isArray(d.fileTypes) && d.fileTypes.every((x) => typeof x === "string" && /^[a-z0-9]{2,5}$/.test(x)))) bad.push({ path: `documents[${i}]`, message: "Check key, labels, purpose, envelope and file types." });
    return { key: String(d.key), label: d.label, purpose: d.purpose, required: d.required ?? false, origin: "company", envelope: d.envelope, fileTypes: d.fileTypes, ...(d.expiry === true ? { expiry: true } : {}) };
  });
  const pr = isObj(raw.pricing) ? raw.pricing : {};
  if (!oneOf(pr.model, PRICING)) bad.push({ path: "pricing.model", message: "Choose a supported pricing model." });
  const groups = (Array.isArray(pr.groups) ? pr.groups : []).filter(isObj).slice(0, 20).map((g, i) => {
    const inputs = (Array.isArray(g.inputs) ? g.inputs : []).filter(isObj).slice(0, 30);
    if (!(typeof g.key === "string" && KEY.test(g.key) && isL(g.label) && inputs.length && inputs.every((x) => typeof x.key === "string" && KEY.test(x.key) && isL(x.label) && oneOf(x.type, ["integer", "decimal", "text", "boolean"])))) bad.push({ path: `pricing.groups[${i}]`, message: "A group needs a key, label and inputs with key, label and type." });
    return { key: String(g.key), label: g.label, repeat: g.repeat !== false, inputs: inputs.map((x) => ({ key: x.key, label: x.label, type: x.type, ...(x.required === true ? { required: true } : {}), ...(x.default !== undefined && ["string", "number", "boolean"].includes(typeof x.default) ? { default: x.default } : {}) })) };
  });
  const lines = (Array.isArray(pr.lines) ? pr.lines : []).filter(isObj).slice(0, 100).map((l, i) => {
    if (!(typeof l.key === "string" && KEY.test(l.key) && isL(l.description) && str(l.quantity, 200) && str(l.unit, 20) && oneOf(l.block, ["UNIT_PRICE", "LUMP_SUM"]) && (l.group === undefined || (typeof l.group === "string" && KEY.test(l.group))) && (l.when === undefined || str(l.when, 300)))) bad.push({ path: `pricing.lines[${i}]`, message: "A line needs a key, description, quantity expression, unit and block type." });
    return { key: String(l.key), ...(l.group ? { group: l.group } : {}), description: l.description, quantity: l.quantity, unit: l.unit, block: l.block, ...(l.when ? { when: l.when } : {}), ...(l.optional === true ? { optional: true } : {}) };
  });
  const ev = isObj(raw.evaluation) ? raw.evaluation : {};
  const modes = (Array.isArray(ev.modes) ? ev.modes : []).filter((m) => oneOf(m, ["qualification", "price", "weighted", "manual"]));
  const scale = isObj(ev.scale) && Number.isInteger(ev.scale.min) && Number.isInteger(ev.scale.max) ? { min: ev.scale.min as number, max: ev.scale.max as number } : { min: 0, max: 5 };
  if (!modes.length || !oneOf(ev.mode, ["qualification", "price", "weighted", "manual"])) bad.push({ path: "evaluation", message: "Choose evaluation modes and a default mode." });
  const criteria = (Array.isArray(ev.criteria) ? ev.criteria : []).filter(isObj).slice(0, 30).map((c, i) => { if (!(typeof c.key === "string" && KEY.test(c.key) && isL(c.label))) bad.push({ path: `evaluation.criteria[${i}]`, message: "A criterion needs a key and an English and Arabic label." }); return { key: String(c.key), label: c.label }; });
  if (bad.length) return { ok: false, problems: bad.slice(0, 20) };
  return { ok: true, content: { schema: 1, sections, fields, questions, documents, pricing: { model: pr.model, groups, lines }, evaluation: { modes, mode: ev.mode, scale, criteria }, workflow: [] } as unknown as TemplateContent };
}

export interface CustomMeta { key: string; title: { en: string; ar: string }; summary?: { en: string; ar: string }; category: string; eventType: "RFI" | "RFQ" | "RFP" }
const REQ = ["rfx", "envelopes", "questionnaire"];

/** Publishes content as this company's template (a new template, or the next version of an existing one). The content is checked exactly as an event would be. */
export async function saveCompanyTemplate(pool: Pool, who: Who, meta: CustomMeta, raw: unknown, note = ""): Promise<TOut<{ key: string; version: number }>> {
  if (!ADMIN.has(who.role)) return err("Only an administrator can customise templates.");
  if (!/^CO_[A-Z0-9_]{1,60}$/.test(meta.key)) return err("Use CO_ followed by capital letters, digits or underscores for the template key.");
  if (!str(meta.title?.en, 160) || !str(meta.title?.ar, 160)) return err("Enter the template name in English and Arabic.");
  if (!["RFI", "RFQ", "RFP"].includes(meta.eventType)) return err("The request is not valid.");
  if (JSON.stringify(raw ?? null).length > MAX_BYTES) return err("The template is too large.");
  const s = sanitise(raw);
  if (!s.ok) return err("The template content is not valid.", s.problems.map((p) => ({ code: "INVALID_FIELD", key: p.path, message: `${p.path}: ${p.message}` })));
  const r = resolve(s.content);
  const requires = [...REQ, ...(s.content.pricing.lines.length ? ["line_pricing"] : [])];
  const v = validateEffective(r.effective, { policies: [], requires });
  const unsupported = requires.filter((x) => !(DEPLOYED_CAPABILITIES as readonly string[]).includes(x));
  if (r.problems.length || v.errors.length || unsupported.length) return err("The template content is not valid.", [...r.problems, ...v.errors]);
  return withTenant(pool, who.tenantId, async (c) => {
    if ((await c.query(`select 1 from template_definition where key = $1`, [meta.key])).rows[0]) return err("That template key is already used.");
    if (!(await c.query(`select 1 from purchase_category where code = $1`, [meta.category])).rows[0]) return err("One of the purchasing categories is not in the catalogue.");
    await c.query(`select pg_advisory_xact_lock(hashtext($1))`, ["tpl:" + who.tenantId + meta.key]);
    const have = (await c.query(`select 1 from company_template where key = $1`, [meta.key])).rows[0];
    if (!have) {
      await c.query(`insert into company_template (tenant_id, key, category_code, event_type, method, pricing_model, title_en, title_ar, summary_en, summary_ar, created_by) values ($1,$2,$3,$4,'invited',$5,$6,$7,$8,$9,$10)`,
        [who.tenantId, meta.key, meta.category, meta.eventType, s.content.pricing.model, meta.title.en.trim(), meta.title.ar.trim(), (meta.summary?.en ?? "").slice(0, 500), (meta.summary?.ar ?? "").slice(0, 500), who.membershipId]);
    }
    const version = ((await c.query(`select coalesce(max(version), 0)::int n from company_template_version where template_key = $1`, [meta.key])).rows[0].n as number) + 1;
    await c.query(`insert into company_template_version (tenant_id, template_key, version, content, content_hash, requires, change_note) values ($1,$2,$3,$4,$5,$6,$7)`,
      [who.tenantId, meta.key, version, JSON.stringify(s.content), hashOf(s.content), requires, note.slice(0, 300)]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "company.template_saved", { key: meta.key, version });
    return { ok: true as const, key: meta.key, version };
  });
}

/** Copies a platform template (its original content, without this company's overrides) as the starting point for a company template. */
export async function cloneTemplate(pool: Pool, who: Who, fromKey: string, meta: CustomMeta): Promise<TOut<{ key: string; version: number }>> {
  if (!ADMIN.has(who.role)) return err("Only an administrator can customise templates.");
  const content = await withTenant(pool, who.tenantId, async (c) => {
    const t = (await allTemplates(c)).find((x) => x.key === fromKey);
    return t?.content ?? null;
  });
  if (!content) return err("One of the selected templates does not exist.");
  return saveCompanyTemplate(pool, who, meta, content, `Copied from ${fromKey}`);
}
