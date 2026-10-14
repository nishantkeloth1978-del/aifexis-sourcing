import { rowName, type InputRow } from "@/templates/schedule";
import type { Effective, L, PriceInput, TemplateContent } from "@/templates/types";

/**
 * The lane view of a bid: a group of the template that is priced as one table (one row per lane, one column per price component).
 * Pure functions only, so the same code serves the supplier screen, the Excel sheet, the server checks and the buyer comparison.
 */
export interface LaneCol { key: string; label: L; type: PriceInput["type"]; required: boolean }
export interface LaneComponent { lineKey: string; label: L; zeroOk: boolean }
export interface Lane {
  key: string;                         // "lane:0": the group key and the row index, the same suffix the event lines carry
  no: number;                          // 1, 2, 3 ... as printed in the Excel sheet
  name: string;
  lotId: string | null;
  quantity: string;                    // yearly volume, the quantity of every price line of the lane
  buyer: Record<string, string>;       // the buyer's inputs for the lane, as text
  items: Record<string, string>;       // price component line key -> event item id
}
export interface LaneGrid {
  groupKey: string; groupLabel: L;
  buyerCols: LaneCol[]; nameKeys: string[]; components: LaneComponent[]; answers: LaneCol[];
  limit: { max: string; answer: string } | null;
  quantityKey: string | null;          // the buyer input that is the yearly quantity, when the lines use it as is
  lanes: Lane[];
}
/** What the supplier states for each lane besides prices: lane key -> answer key -> value. */
export type LaneTerms = Record<string, Record<string, string>>;

export interface GridItem { id: string; templateLine: string | null; lotId: string | null; quantity: string }

const bare = (d: L): L => ({ en: d.en.replace(/[:：]?\s*\{name\}/g, "").trim(), ar: d.ar.replace(/[:：]?\s*\{name\}/g, "").trim() });
const col = (i: PriceInput): LaneCol => ({ key: i.key, label: i.label, type: i.type, required: i.required === true });

/** The grid for an event, or null when its template has no grid group or no lines were made from it yet. */
export function buildLaneGrid(e: Effective | TemplateContent | null | undefined, groups: Record<string, InputRow[]> | undefined, items: GridItem[]): LaneGrid | null {
  const g = e?.pricing.groups.find((x) => x.grid);
  if (!e || !g) return null;
  const lines = e.pricing.lines.filter((l) => l.group === g.key);
  if (!lines.length) return null;
  const rows = groups?.[g.key] ?? [];
  const byRow = new Map<number, Record<string, string>>();
  const qty = new Map<number, string>(), lot = new Map<number, string | null>();
  for (const it of items) {
    const m = /^([\w-]+):(\d+)$/.exec(it.templateLine ?? "");
    if (!m || !lines.some((l) => l.key === m[1])) continue;
    const idx = Number(m[2]);
    byRow.set(idx, { ...(byRow.get(idx) ?? {}), [m[1]!]: it.id });
    qty.set(idx, it.quantity); lot.set(idx, it.lotId);
  }
  const lanes: Lane[] = [...byRow.keys()].sort((a, b) => a - b).map((idx) => {
    const row = rows[idx] ?? {};
    return {
      key: `${g.key}:${idx}`, no: idx + 1, name: rowName(g, row, idx, "en"), lotId: lot.get(idx) ?? null, quantity: qty.get(idx) ?? "0",
      buyer: Object.fromEntries(g.inputs.map((i) => [i.key, String(row[i.key] ?? i.default ?? "")])), items: byRow.get(idx)!,
    };
  });
  if (!lanes.length) return null;
  return {
    groupKey: g.key, groupLabel: g.label, buyerCols: g.inputs.map(col), nameKeys: g.nameFrom ?? [], answers: (g.answers ?? []).map(col), limit: g.limit ?? null,
    quantityKey: /^[A-Za-z_]\w*$/.test(lines[0]!.quantity) && g.inputs.some((i) => i.key === lines[0]!.quantity) ? lines[0]!.quantity : null,
    components: lines.map((l) => ({ lineKey: l.key, label: bare(l.description), zeroOk: l.zeroOk === true || l.optional === true })), lanes,
  };
}

export const itemIdsOf = (grid: LaneGrid): Set<string> => new Set(grid.lanes.flatMap((l) => Object.values(l.items)));
/** A lane has a bid when any of its lines has a price (or a "no bid" mark). */
export const laneHasPrice = (lane: Lane, prices: Record<string, string>): boolean => Object.values(lane.items).some((id) => (prices[id] ?? "").trim() !== "");

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Keeps the answers of lanes that have a bid and checks them. Messages are English; the screens translate them. */
export function checkTerms(grid: LaneGrid, terms: LaneTerms | undefined, prices: Record<string, string>): { ok: true; terms: LaneTerms } | { ok: false; error: string } {
  const out: LaneTerms = {};
  for (const lane of grid.lanes) {
    if (!laneHasPrice(lane, prices)) continue;
    const given = terms?.[lane.key] ?? {};
    const clean: Record<string, string> = {};
    for (const c of grid.answers) {
      const v = String(given[c.key] ?? "").trim();
      if (!v) { if (c.required) return { ok: false, error: `Lane ${lane.no}: enter ${c.label.en}.` }; continue; }
      if (c.type === "integer" && !/^\d{1,4}$/.test(v)) return { ok: false, error: `Lane ${lane.no}: ${c.label.en} must be a whole number.` };
      if (c.type === "decimal" && !/^\d{1,9}(\.\d{1,4})?$/.test(v)) return { ok: false, error: `Lane ${lane.no}: ${c.label.en} must be a number.` };
      if (c.type === "date" && !isDate(v)) return { ok: false, error: `Lane ${lane.no}: ${c.label.en} must be a date (year-month-day).` };
      clean[c.key] = c.type === "text" ? v.slice(0, 200) : v;
    }
    out[lane.key] = clean;
  }
  return { ok: true, terms: out };
}

/** Does the lane meet the buyer's limit? null when there is no limit or no answer yet. */
export function meetsLimit(grid: LaneGrid, lane: Lane, terms: Record<string, string> | undefined): boolean | null {
  if (!grid.limit) return null;
  const max = Number(lane.buyer[grid.limit.max]), got = Number(terms?.[grid.limit.answer]);
  if (!lane.buyer[grid.limit.max] || !terms?.[grid.limit.answer] || Number.isNaN(max) || Number.isNaN(got)) return null;
  return got <= max;
}

/** Canonical text of the answers, used in the receipt fingerprint so the receipt covers them too. */
export function termsCanon(terms: LaneTerms | undefined): string {
  const keys = Object.keys(terms ?? {}).sort();
  return keys.length ? JSON.stringify(keys.map((k) => [k, Object.entries(terms![k]!).sort(([a], [b]) => a.localeCompare(b))])) : "";
}
