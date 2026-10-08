import type { PoolClient } from "pg";
import { catalogByCodes, cleanCode } from "./service";

interface Fillable { description: string; unit: string; code?: string; rowNo?: number }

/**
 * Lines that give a catalogue code but no description or unit get them from the catalogue.
 * Lines whose code is unknown keep what they have (validation then reports anything still missing).
 */
export async function fillFromCatalog<T extends Fillable>(c: PoolClient, rows: T[]): Promise<{ rows: T[]; unknown: { rowNo: number | undefined; code: string }[] }> {
  const need = rows.filter((r) => r.code && (!r.description?.trim() || !r.unit?.trim()));
  if (!need.length) return { rows, unknown: [] };
  const found = await catalogByCodes(c, need.map((r) => r.code!));
  const unknown: { rowNo: number | undefined; code: string }[] = [];
  const out = rows.map((r) => {
    if (!r.code || (r.description?.trim() && r.unit?.trim())) return r;
    const hit = found.get(cleanCode(r.code));
    if (!hit) { unknown.push({ rowNo: r.rowNo, code: r.code }); return r; }
    return { ...r, description: r.description?.trim() || hit.description, unit: r.unit?.trim() || hit.unit };
  });
  return { rows: out, unknown };
}
