import { evaluate, parse, toDecimal3, ExprError, type Env } from "./expr";
import type { Effective, L, PriceGroup, TemplateContent } from "./types";

export type InputRow = Record<string, string | number | boolean | null | undefined>;
/** What the buyer enters: one row per site/role/lane/milestone for each repeating group, plus the optional lines they want included. */
export interface TemplateInputs { groups: Record<string, InputRow[]>; include?: string[] }
export interface ScheduleItem { lineKey: string; groupKey: string | null; rowIndex: number | null; description: string; quantity: string; unit: string; blockType: "UNIT_PRICE" | "LUMP_SUM" }
export interface Missing { group: string; row: number | null; input: string; why: "missing" | "invalid" }
export interface Schedule { items: ScheduleItem[]; incomplete: boolean; missing: Missing[] }

const fill = (d: L, row: InputRow | null, group: PriceGroup | undefined, idx: number | null, locale: "en" | "ar"): string => {
  const base = locale === "ar" && d.ar ? d.ar : d.en;
  const name = row?.name != null && String(row.name).trim() ? String(row.name).trim() : group ? `${locale === "ar" ? group.label.ar || group.label.en : group.label.en} ${(idx ?? 0) + 1}` : "";
  return base.replace(/\{name\}/g, name);
};
const present = (v: InputRow[string]) => v !== undefined && v !== null && String(v).trim() !== "";

/**
 * Turns the buyer's inputs into the lines suppliers will price. Lines are plain quantity x price lines, so the existing pricing,
 * ranking, award and handover run unchanged. Missing or invalid inputs never produce a guessed number: the schedule is marked incomplete
 * and the affected lines are left out.
 */
export function buildSchedule(e: Effective | TemplateContent, inputs: TemplateInputs, locale: "en" | "ar" = "en"): Schedule {
  const items: ScheduleItem[] = [], missing: Missing[] = [];
  const groups = new Map(e.pricing.groups.map((g) => [g.key, g]));
  const include = new Set(inputs.include ?? []);
  // validate every row of every group once
  const rowsOk = new Map<string, boolean[]>();
  for (const g of e.pricing.groups) {
    const rows = inputs.groups?.[g.key] ?? [];
    if (g.repeat && rows.length === 0 && e.pricing.lines.some((l) => l.group === g.key && !l.optional)) missing.push({ group: g.key, row: null, input: "rows", why: "missing" });
    rowsOk.set(g.key, rows.map((r, i) => {
      let ok = true;
      for (const inp of g.inputs) {
        const v = r[inp.key] ?? inp.default;
        if (inp.required && !present(v)) { missing.push({ group: g.key, row: i, input: inp.key, why: "missing" }); ok = false; }
        else if (present(v) && (inp.type === "integer" ? !/^\d{1,9}$/.test(String(v)) || (inp.required && Number(v) <= 0) : inp.type === "decimal" ? !/^\d{1,12}(\.\d{1,3})?$/.test(String(v)) || (inp.required && Number(v) <= 0) : false)) { missing.push({ group: g.key, row: i, input: inp.key, why: "invalid" }); ok = false; }
      }
      return ok;
    }));
  }
  for (const l of e.pricing.lines) {
    if (l.optional && !include.has(l.key)) continue;
    const g = l.group ? groups.get(l.group) : undefined;
    const emit = (row: InputRow | null, idx: number | null) => {
      const env: Env = {};
      if (g && row) for (const inp of g.inputs) env[inp.key] = (row[inp.key] ?? inp.default) as Env[string];
      try {
        if (l.when) { const w = evaluate(parse(l.when), env); if (w === false) return; if (w == null) { missing.push({ group: l.group ?? "", row: idx, input: "when", why: "missing" }); return; } }
        const q = toDecimal3(evaluate(parse(l.quantity), env));
        if (q === null || Number(q) <= 0) { missing.push({ group: l.group ?? "", row: idx, input: l.key, why: q === null ? "missing" : "invalid" }); return; }
        items.push({ lineKey: l.key, groupKey: l.group ?? null, rowIndex: idx, description: fill(l.description, row, g, idx, locale), quantity: q, unit: l.unit, blockType: l.block });
      } catch (err) { if (!(err instanceof ExprError)) throw err; missing.push({ group: l.group ?? "", row: idx, input: l.key, why: "invalid" }); }
    };
    if (!g) { emit(null, null); continue; }
    (inputs.groups?.[g.key] ?? []).forEach((r, i) => { if (rowsOk.get(g.key)![i]) emit(r, i); });
  }
  // read order: each site/role together, in the order the groups first appear in the template
  const first = new Map<string, number>(); e.pricing.lines.forEach((l, i) => { if (l.group && !first.has(l.group)) first.set(l.group, i); });
  const idx = new Map(e.pricing.lines.map((l, i) => [l.key, i]));
  items.sort((a, b) => (a.groupKey ? first.get(a.groupKey)! : idx.get(a.lineKey)!) - (b.groupKey ? first.get(b.groupKey)! : idx.get(b.lineKey)!) || (a.rowIndex ?? 0) - (b.rowIndex ?? 0) || idx.get(a.lineKey)! - idx.get(b.lineKey)!);
  return { items, incomplete: missing.length > 0, missing };
}
