import { parseDec } from "@/engine/decimal";

/** A price break: from this quantity upwards the unit price is this one. */
export interface Tier { minQty: string; unitPrice: string }
export const MAX_TIERS = 4;

export type TierCheck = { ok: true; tiers: Tier[]; base: bigint; effective: bigint; applied: Tier | null } | { ok: false; error: string };

/**
 * Checks a supplier's price breaks for one unit-price line and picks the price that applies at the event's quantity.
 * Quantities rise and prices fall: each break must be cheaper than the one before it (and than the base price).
 */
export function applyTiers(baseRaw: string, tiersRaw: Tier[] | undefined, qtyRaw: string, lineNo: number): TierCheck {
  const base = parseDec(baseRaw.trim(), 4);
  if (base === null) return { ok: false, error: `Enter a price for line ${lineNo} (up to 4 decimals).` };
  const list = (tiersRaw ?? []).filter((t) => String(t.minQty ?? "").trim() !== "" || String(t.unitPrice ?? "").trim() !== "");
  if (list.length > MAX_TIERS) return { ok: false, error: `Line ${lineNo}: use at most ${MAX_TIERS} price breaks.` };
  const qty = parseDec(qtyRaw, 3) ?? 0n;
  const out: { minQty: bigint; price: bigint; t: Tier }[] = [];
  for (const t of list) {
    const q = parseDec(String(t.minQty).trim(), 3), p = parseDec(String(t.unitPrice).trim(), 4);
    if (q === null || q <= 0n || p === null || p <= 0n) return { ok: false, error: `Line ${lineNo}: a price break needs a quantity and a price greater than zero.` };
    out.push({ minQty: q, price: p, t: { minQty: String(t.minQty).trim(), unitPrice: String(t.unitPrice).trim() } });
  }
  out.sort((a, b) => (a.minQty < b.minQty ? -1 : a.minQty > b.minQty ? 1 : 0));
  let prevQ = 0n, prevP = base;
  for (const o of out) {
    if (o.minQty <= prevQ) return { ok: false, error: `Line ${lineNo}: price break quantities must be different and above zero.` };
    if (o.price >= prevP) return { ok: false, error: `Line ${lineNo}: each price break must be cheaper than the one before it.` };
    prevQ = o.minQty; prevP = o.price;
  }
  const hit = [...out].reverse().find((o) => o.minQty <= qty) ?? null;
  return { ok: true, tiers: out.map((o) => o.t), base, effective: hit ? hit.price : base, applied: hit ? hit.t : null };
}
