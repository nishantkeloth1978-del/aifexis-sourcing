import ExcelJS from "exceljs";
import { cellText } from "@/lib/sheetread";
import type { CustomMeta } from "./custom";
import type { TemplateContent } from "./types";

/** One workbook per template: a sheet for each kind of object, one row per object, so a spreadsheet user can build or edit a whole template. */
const FIELDS = ["key", "section", "label_en", "label_ar", "type", "source", "envelope", "required", "visible", "default", "options", "help_en", "help_ar"];
const QUESTIONS = ["key", "section", "label_en", "label_ar", "type", "use", "required", "options", "evidence"];
const DOCS = ["key", "label_en", "label_ar", "purpose_en", "purpose_ar", "required", "envelope", "file_types", "expiry"];
const GROUPS = ["group", "group_label_en", "group_label_ar", "repeat", "input_key", "input_label_en", "input_label_ar", "input_type", "input_required", "input_default"];
const LINES = ["key", "group", "description_en", "description_ar", "quantity", "unit", "block", "when", "optional"];
const CRIT = ["key", "label_en", "label_ar"];
const SECS = ["key", "label_en", "label_ar"];
export const MAX_SHEET_ROWS = 400;

const yes = (v: unknown) => (v === true ? "yes" : v === false || v === undefined ? "" : String(v));
const optsOut = (o?: { key: string; label: { en: string; ar: string } }[]) => (o ?? []).map((x) => `${x.key}=${x.label.en}||${x.label.ar}`).join("\n");

export async function templateWorkbook(meta: CustomMeta | null, c: TemplateContent): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const add = (name: string, head: string[], rows: unknown[][], widths?: number[]) => {
    const ws = wb.addWorksheet(name);
    ws.columns = head.map((h, i) => ({ header: h, key: h, width: widths?.[i] ?? 22 }));
    rows.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true }; ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.eachRow((row) => row.eachCell((cell) => { cell.alignment = { wrapText: true, vertical: "top" }; }));
  };
  const t = wb.addWorksheet("Template");
  t.columns = [{ header: "Setting", key: "k", width: 24 }, { header: "Value", key: "v", width: 60 }];
  [["Key", meta?.key ?? "CO_MY_TEMPLATE"], ["Name (English)", meta?.title.en ?? ""], ["Name (Arabic)", meta?.title.ar ?? ""], ["Category", meta?.category ?? "GENERAL"], ["Event type", meta?.eventType ?? "RFQ"],
    ["Pricing model", c.pricing.model], ["Evaluation mode", c.evaluation.mode], ["Evaluation modes", c.evaluation.modes.join(", ")], ["Score minimum", c.evaluation.scale.min], ["Score maximum", c.evaluation.scale.max]].forEach((r) => t.addRow(r));
  t.getRow(1).font = { bold: true };
  add("Sections", SECS, c.sections.map((s) => [s.key, s.label.en, s.label.ar]));
  add("Fields", FIELDS, c.fields.map((f) => [f.key, f.section, f.label.en, f.label.ar, f.type, f.source, f.envelope, yes(f.required), f.visible ?? "", f.default === undefined ? "" : String(f.default), optsOut(f.options), f.help?.en ?? "", f.help?.ar ?? ""]), [20, 14, 28, 28, 12, 10, 12, 14, 24, 10, 36, 24, 24]);
  add("Questions", QUESTIONS, c.questions.map((q) => [q.key, q.section, q.label.en, q.label.ar, q.type, q.use, yes(q.required), optsOut(q.options), yes(q.evidence)]), [20, 14, 36, 36, 10, 12, 14, 36, 10]);
  add("Documents", DOCS, c.documents.map((d) => [d.key, d.label.en, d.label.ar, d.purpose.en, d.purpose.ar, yes(d.required), d.envelope, d.fileTypes.join(", "), yes(d.expiry)]), [20, 28, 28, 36, 36, 14, 12, 16, 10]);
  add("PriceGroups", GROUPS, c.pricing.groups.flatMap((g) => (g.inputs.length ? g.inputs : [null]).map((i) => i === null ? [g.key, g.label.en, g.label.ar, g.repeat ? "yes" : "no", "", "", "", "", "", ""] : ( [g.key, g.label.en, g.label.ar, g.repeat ? "yes" : "no", i.key, i.label.en, i.label.ar, i.type, yes(i.required), i.default === undefined ? "" : String(i.default)]))), [16, 22, 22, 8, 16, 26, 26, 12, 12, 12]);
  add("PriceLines", LINES, c.pricing.lines.map((l) => [l.key, l.group ?? "", l.description.en, l.description.ar, l.quantity, l.unit, l.block, l.when ?? "", yes(l.optional)]), [18, 14, 34, 34, 22, 12, 12, 24, 10]);
  add("Criteria", CRIT, c.evaluation.criteria.map((x) => [x.key, x.label.en, x.label.ar]));
  const h = wb.addWorksheet("How to fill");
  h.getColumn(1).width = 110;
  [["One object per row. Keep the first row (headers) as it is. Keys use lower-case letters, digits and underscores and never change once events use the template."],
    ["Template sheet: the key must start with CO_. Pricing model and evaluation mode are taken from here."],
    ["required: yes, or empty for no, or a condition such as: spec_compliance != \"compliant\" (refer to other keys in the template)."],
    ["options: one per line as key=English||Arabic. Needed for type single or multi."],
    ["Fields: source is buyer (the buyer fills it in) or supplier (the supplier answers). envelope is technical or commercial (price-related answers must be commercial)."],
    ["PriceGroups: one row per input of a group (for example a site, a role or a lane). PriceLines: quantity is a formula over the group's inputs, such as headcount * days; block is UNIT_PRICE or LUMP_SUM; optional lines are included by the buyer."],
    ["After uploading, you see every problem with its sheet and row before anything is saved."]].forEach((r) => h.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface SheetProblem { sheet: string; row: number; message: string }
export interface ParsedSheet { meta: Partial<CustomMeta> & { pricingModel?: string }; raw: Record<string, unknown>; rowMap: Record<string, number[]>; problems: SheetProblem[] }

const bool = (s: string): boolean | string | undefined => { const v = s.trim(); if (!v) return undefined; const l = v.toLowerCase(); return ["yes", "true", "1", "y"].includes(l) ? true : ["no", "false", "0", "n"].includes(l) ? false : v; };
const scalar = (s: string): string | number | boolean | undefined => { const v = s.trim(); if (!v) return undefined; if (/^(true|false)$/i.test(v)) return v.toLowerCase() === "true"; if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v); return v; };
const list = (s: string) => s.split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);

function parseOptions(s: string, sheet: string, row: number, problems: SheetProblem[]) {
  const out: { key: string; label: { en: string; ar: string } }[] = [];
  for (const line of s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^([a-z0-9_]{1,80})=(.+?)\|\|(.+)$/i.exec(line);
    if (!m) { problems.push({ sheet, row, message: `Option "${line.slice(0, 40)}" must look like key=English||Arabic.` }); continue; }
    out.push({ key: m[1]!.toLowerCase(), label: { en: m[2]!.trim(), ar: m[3]!.trim() } });
  }
  return out;
}

export async function parseTemplateWorkbook(filename: string, bytes: Buffer): Promise<ParsedSheet | { fatal: string }> {
  if (!/\.xlsx$/i.test(filename)) return { fatal: "Use an Excel (.xlsx) file." };
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(bytes as unknown as ArrayBuffer); } catch { return { fatal: "That file could not be read. Check that it is a valid Excel file." }; }
  const problems: SheetProblem[] = [];
  const rowMap: Record<string, number[]> = {};
  const table = (name: string, head: string[], required: string[]): { row: number; v: Record<string, string> }[] => {
    const ws = wb.getWorksheet(name);
    if (!ws) { if (required.length) problems.push({ sheet: name, row: 0, message: `The sheet "${name}" is missing. Use the downloaded template.` }); return []; }
    const cols = new Map<string, number>();
    ws.getRow(1).eachCell((cell, n) => { const h = cellText(cell.value).trim().toLowerCase(); if (head.includes(h)) cols.set(h, n); });
    const miss = required.filter((h) => !cols.has(h));
    if (miss.length) { problems.push({ sheet: name, row: 1, message: `Missing column(s): ${miss.join(", ")}.` }); return []; }
    const rows: { row: number; v: Record<string, string> }[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const v: Record<string, string> = {}; let any = false;
      for (const h of head) { const n = cols.get(h); const t = n ? cellText(ws.getRow(r).getCell(n).value).trim() : ""; v[h] = t; if (t) any = true; }
      if (any) rows.push({ row: r, v });
    }
    if (rows.length > MAX_SHEET_ROWS) { problems.push({ sheet: name, row: 0, message: `More than ${MAX_SHEET_ROWS} rows.` }); return []; }
    return rows;
  };
  const L = (en: string, ar: string) => ({ en, ar });
  const meta: ParsedSheet["meta"] = {};
  const ts = wb.getWorksheet("Template");
  if (!ts) problems.push({ sheet: "Template", row: 0, message: 'The sheet "Template" is missing. Use the downloaded template.' });
  else ts.eachRow((row, n) => {
    if (n === 1) return;
    const k = cellText(row.getCell(1).value).trim().toLowerCase(), v = cellText(row.getCell(2).value).trim();
    if (k === "key") meta.key = v.toUpperCase(); else if (k === "name (english)") meta.title = { en: v, ar: meta.title?.ar ?? "" }; else if (k === "name (arabic)") meta.title = { en: meta.title?.en ?? "", ar: v };
    else if (k === "category") meta.category = v.toUpperCase(); else if (k === "event type") meta.eventType = v.toUpperCase() as CustomMeta["eventType"]; else if (k === "pricing model") meta.pricingModel = v.toLowerCase();
    else if (k === "evaluation mode") (meta as Record<string, unknown>).evalMode = v.toLowerCase(); else if (k === "evaluation modes") (meta as Record<string, unknown>).evalModes = list(v);
    else if (k === "score minimum") (meta as Record<string, unknown>).min = Number(v); else if (k === "score maximum") (meta as Record<string, unknown>).max = Number(v);
  });
  const m = meta as Record<string, unknown>;

  const sections = table("Sections", SECS, []);
  const fields = table("Fields", FIELDS, ["key", "label_en", "label_ar", "type", "source", "envelope", "section"]);
  const questions = table("Questions", QUESTIONS, ["key", "label_en", "label_ar", "type", "use", "section"]);
  const docs = table("Documents", DOCS, ["key", "label_en", "label_ar", "purpose_en", "purpose_ar", "envelope"]);
  const grows = table("PriceGroups", GROUPS, []);
  const lrows = table("PriceLines", LINES, []);
  const crit = table("Criteria", CRIT, []);

  rowMap.sections = sections.map((x) => x.row); rowMap.fields = fields.map((x) => x.row); rowMap.questions = questions.map((x) => x.row); rowMap.documents = docs.map((x) => x.row); rowMap.lines = lrows.map((x) => x.row); rowMap.criteria = crit.map((x) => x.row);

  const groupMap = new Map<string, { key: string; label: { en: string; ar: string }; repeat: boolean; inputs: Record<string, unknown>[] }>();
  const groupRows: number[] = [];
  for (const { row, v } of grows) {
    const key = v.group!.toLowerCase();
    if (!groupMap.has(key)) { groupMap.set(key, { key, label: L(v.group_label_en!, v.group_label_ar!), repeat: bool(v.repeat!) !== false, inputs: [] }); groupRows.push(row); }
    if (v.input_key) groupMap.get(key)!.inputs.push({ key: v.input_key!.toLowerCase(), label: L(v.input_label_en!, v.input_label_ar!), type: v.input_type!.toLowerCase(), ...(bool(v.input_required!) === true ? { required: true } : {}), ...(scalar(v.input_default!) !== undefined ? { default: scalar(v.input_default!) } : {}) });
  }
  rowMap.groups = groupRows;

  const raw = {
    sections: sections.map(({ v }) => ({ key: v.key!.toLowerCase(), label: L(v.label_en!, v.label_ar!) })),
    fields: fields.map(({ row, v }) => ({ key: v.key!.toLowerCase(), section: v.section!.toLowerCase(), label: L(v.label_en!, v.label_ar!), type: v.type!.toLowerCase(), source: v.source!.toLowerCase(), envelope: v.envelope!.toLowerCase(),
      ...(bool(v.required!) !== undefined ? { required: bool(v.required!) } : {}), ...(v.visible ? { visible: v.visible } : {}), ...(scalar(v.default!) !== undefined ? { default: scalar(v.default!) } : {}),
      ...(v.options ? { options: parseOptions(v.options, "Fields", row, problems) } : {}), ...(v.help_en && v.help_ar ? { help: L(v.help_en, v.help_ar) } : {}) })),
    questions: questions.map(({ row, v }) => ({ key: v.key!.toLowerCase(), section: v.section!.toLowerCase(), label: L(v.label_en!, v.label_ar!), type: v.type!.toLowerCase(), use: v.use!.toLowerCase(), required: bool(v.required!) ?? false,
      ...(v.options ? { options: parseOptions(v.options, "Questions", row, problems) } : {}), ...(bool(v.evidence!) === true ? { evidence: true } : {}) })),
    documents: docs.map(({ v }) => ({ key: v.key!.toLowerCase(), label: L(v.label_en!, v.label_ar!), purpose: L(v.purpose_en!, v.purpose_ar!), required: bool(v.required!) ?? false, envelope: v.envelope!.toLowerCase(), fileTypes: list(v.file_types!), ...(bool(v.expiry!) === true ? { expiry: true } : {}) })),
    pricing: { model: m.pricingModel, groups: [...groupMap.values()], lines: lrows.map(({ v }) => ({ key: v.key!.toLowerCase(), ...(v.group ? { group: v.group.toLowerCase() } : {}), description: L(v.description_en!, v.description_ar!), quantity: v.quantity, unit: v.unit, block: v.block!.toUpperCase(), ...(v.when ? { when: v.when } : {}), ...(bool(v.optional!) === true ? { optional: true } : {}) })) },
    evaluation: { modes: m.evalModes ?? [], mode: m.evalMode, scale: { min: Number.isInteger(m.min) ? m.min : 0, max: Number.isInteger(m.max) ? m.max : 5 }, criteria: crit.map(({ v }) => ({ key: v.key!.toLowerCase(), label: L(v.label_en!, v.label_ar!) })) },
  };
  delete m.pricingModel; delete m.evalMode; delete m.evalModes; delete m.min; delete m.max;
  return { meta, raw, rowMap, problems };
}

/** Turns a sanitise path such as fields[3] into "Fields row 7" using the rows recorded while reading. */
export function placeOf(path: string, rowMap: Record<string, number[]>): { sheet: string; row: number } | null {
  const m = /^(sections|fields|questions|documents|criteria)\[(\d+)\]|^pricing\.(lines|groups)\[(\d+)\]|^evaluation\.(criteria)\[(\d+)\]/.exec(path);
  if (!m) return null;
  const name = m[1] ?? m[3] ?? m[5]!, idx = Number(m[2] ?? m[4] ?? m[6]);
  const sheet = { sections: "Sections", fields: "Fields", questions: "Questions", documents: "Documents", lines: "PriceLines", groups: "PriceGroups", criteria: "Criteria" }[name]!;
  const row = rowMap[name]?.[idx];
  return row ? { sheet, row } : null;
}
