import { parseDec, rescale } from "@/engine/decimal";
import { applyTiers, type Tier } from "./tiers";

export interface PricedLine { id: string; lineNo: number; quantity: string; blockType?: string; zeroOk?: boolean }

/** The amount of one line as the supplier sees it while typing: tier break applied, rounded to 2 decimals. Null while incomplete or invalid. */
export function lineAmount(it: PricedLine, prices: Record<string, string>, tiers: Record<string, Tier[]>): bigint | null {
  if (it.zeroOk && (prices[it.id] ?? "") === "NB") return 0n;
  const p = parseDec(prices[it.id] ?? "", 4); if (p === null || (p === 0n && !it.zeroOk)) return null;
  const q = parseDec(it.quantity, 3) ?? 0n;
  if (it.blockType !== "LUMP_SUM" && (tiers[it.id] ?? []).some((t) => t.minQty || t.unitPrice)) {
    const ck = applyTiers(prices[it.id] ?? "", tiers[it.id], it.quantity, it.lineNo);
    return ck.ok ? rescale(ck.effective * q, 7, 2) : null;
  }
  return it.blockType === "LUMP_SUM" ? rescale(p, 4, 2) : rescale(p * q, 7, 2);
}
