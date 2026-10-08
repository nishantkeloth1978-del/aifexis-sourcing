import { parseDec, roundDiv } from "@/engine/decimal";

const S = 6n, SC = 10n ** S;
export interface Scale { min: number; max: number }

/** Weighted technical score on a 0-100 basis. Each criterion: (score - min) / (max - min) x weight. Weights must total 100. */
export function technicalScore(scores: number[], weights: number[], scale: Scale): { ok: true; score: string } | { ok: false; error: string } {
  if (scores.length !== weights.length || !scores.length) return { ok: false, error: "Every criterion needs a score and a weight." };
  if (weights.reduce((a, b) => a + b, 0) !== 100) return { ok: false, error: "The weights must total 100." };
  if (scale.max <= scale.min) return { ok: false, error: "The score scale is not valid." };
  const span = BigInt(scale.max - scale.min);
  let total = 0n;
  for (const [i, s] of scores.entries()) {
    if (!Number.isFinite(s) || s < scale.min || s > scale.max) return { ok: false, error: `Scores must be between ${scale.min} and ${scale.max}.` };
    total += roundDiv(BigInt(Math.round((s - scale.min) * 1000)) * BigInt(weights[i]!) * SC, span * 1000n);
  }
  return { ok: true, score: fmt(total) };
}

/** Commercial score: lowest comparable qualified offer / this offer x 100. A zero or missing offer is not comparable and needs review. */
export function commercialScore(offer: string, lowest: string): { ok: true; score: string } | { ok: false; review: true; reason: string } {
  const o = parseDec(offer, 2), l = parseDec(lowest, 2);
  if (o === null || l === null || o <= 0n || l <= 0n) return { ok: false, review: true, reason: "The offer is zero or not comparable and needs a manual decision." };
  return { ok: true, score: fmt(roundDiv(l * 100n * SC, o)) };
}

/** Combined score from technical and commercial scores with weights that total 100. */
export function combinedScore(technical: string, commercial: string, tw: number, cw: number): string | null {
  if (tw + cw !== 100) return null;
  const t = parseDec(technical, 6), c = parseDec(commercial, 6);
  if (t === null || c === null) return null;
  return fmt(roundDiv(t * BigInt(tw) + c * BigInt(cw), 100n));
}

const fmt = (v: bigint) => { const s = v.toString().padStart(7, "0"); return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""); };
