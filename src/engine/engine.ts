import { createHash } from "node:crypto";
import { formatDec, parseDec, pow10, rescale, roundDiv } from "./decimal";
import type {
  BidderResult, BidInput, BlockDef, BlockInput, CalcRun, Line, ModelDef, Rates, Reason, ScoreRow,
} from "./types";

/**
 * Deterministic calculation engine (spec: Pricing and Calculation Engine v0.1).
 *  - exact decimal arithmetic on BigInt, round half up
 *  - each block is summed exactly in bid currency, converted and rounded ONCE to 2 places
 *  - adjustments are applied to the rounded block values and rounded once
 *  - missing or doubtful input gives an INCOMPLETE run with reasons; never a provisional number
 */

const EVAL_SCALE = 2; // minor units of the evaluation currency
const PRICE_SCALE = 2;
const QTY_SCALE = 3;
const RATE_SCALE = 6;
const PCT_SCALE = 6;
const WEIGHT_SCALE = 4;

export class ModelError extends Error {}

interface Raw { v: bigint; scale: number }

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

export function hashInputs(inputs: unknown): string {
  return createHash("sha256").update(stableStringify(inputs)).digest("hex");
}

function toEvalCurrency(raw: Raw, bidCurrency: string, model: ModelDef, rates: Rates): bigint | "MISSING_RATE" {
  if (bidCurrency === model.evaluationCurrency) return rescale(raw.v, raw.scale, EVAL_SCALE);
  const rateStr = rates[bidCurrency];
  const rate = rateStr === undefined ? null : parseDec(rateStr, RATE_SCALE);
  if (rate == null || rate <= 0n) return "MISSING_RATE";
  return rescale(raw.v * rate, raw.scale + RATE_SCALE, EVAL_SCALE);
}

function lineRaw(def: BlockDef, line: Line, reasons: string[]): Raw | null {
  const bad = (code: string) => { reasons.push(code); return null; };
  const unitCheck = () => {
    if (line.requiredUnit !== undefined && line.unit !== line.requiredUnit && !line.unitMapped) {
      reasons.push(`UNIT_MISMATCH:${line.id ?? def.id}`);
      return false;
    }
    return true;
  };
  switch (def.type) {
    case "UNIT_PRICE": {
      const p = parseDec(line.unitPrice, PRICE_SCALE);
      const q = parseDec(line.qty, QTY_SCALE);
      if (line.unitPrice === undefined || line.unitPrice === "") return bad(`UNPRICED_LINE:${line.id ?? def.id}`);
      if (p == null || q == null) return bad(`INVALID_NUMBER:${line.id ?? def.id}`);
      if (p === 0n && !def.allowZero) return bad(`ZERO_NOT_ALLOWED:${line.id ?? def.id}`);
      if (!unitCheck()) return null;
      return { v: p * q, scale: PRICE_SCALE + QTY_SCALE };
    }
    case "LUMP_SUM": {
      if (line.price === undefined || line.price === "") return bad(`UNPRICED_LINE:${line.id ?? def.id}`);
      const p = parseDec(line.price, PRICE_SCALE);
      if (p == null) return bad(`INVALID_NUMBER:${line.id ?? def.id}`);
      if (p === 0n && !def.allowZero) return bad(`ZERO_NOT_ALLOWED:${line.id ?? def.id}`);
      return { v: p, scale: PRICE_SCALE };
    }
    case "RATE_X_EST_QTY": {
      if (line.rate === undefined || line.rate === "") return bad(`UNPRICED_LINE:${line.id ?? def.id}`);
      const r = parseDec(line.rate, PRICE_SCALE);
      const q = parseDec(line.evalQty, QTY_SCALE);
      if (r == null || q == null) return bad(`INVALID_NUMBER:${line.id ?? def.id}`);
      if (r === 0n && !def.allowZero) return bad(`ZERO_NOT_ALLOWED:${line.id ?? def.id}`);
      return { v: r * q, scale: PRICE_SCALE + QTY_SCALE };
    }
    default:
      return bad(`UNSUPPORTED_BLOCK:${def.id}`);
  }
}

function blockRaw(def: BlockDef, input: BlockInput | undefined, reasons: string[]): Raw | null {
  const required = def.required !== false;
  if (input === undefined) {
    if (required) reasons.push(`UNPRICED_BLOCK:${def.id}`);
    return required ? null : { v: 0n, scale: PRICE_SCALE };
  }
  if (def.type === "CAPPED_AMOUNT") {
    const cap = "cap" in input ? parseDec(input.cap, PRICE_SCALE) : null;
    const pct = parseDec("evaluatedPct" in input && input.evaluatedPct !== undefined ? input.evaluatedPct : "1", 4);
    if (cap == null || pct == null) { reasons.push(`INVALID_NUMBER:${def.id}`); return null; }
    if (cap === 0n && !def.allowZero) { reasons.push(`ZERO_NOT_ALLOWED:${def.id}`); return null; }
    return { v: cap * pct, scale: PRICE_SCALE + 4 };
  }
  if (!("lines" in input) || input.lines.length === 0) {
    if (required) reasons.push(`UNPRICED_BLOCK:${def.id}`);
    return required ? null : { v: 0n, scale: PRICE_SCALE };
  }
  let total = 0n;
  const scale = PRICE_SCALE + QTY_SCALE;
  let ok = true;
  for (const line of input.lines) {
    const raw = lineRaw(def, line, reasons);
    if (raw == null) { ok = false; continue; }
    total += rescale(raw.v, raw.scale, scale); // exact: all lines share one scale, no rounding happens here
  }
  return ok ? { v: total, scale } : null;
}

interface Evaluated { result: BidderResult; totalV: bigint }

function evaluateBidder(model: ModelDef, bid: BidInput, rates: Rates, reasons: Reason[]): Evaluated | null {
  const local: string[] = [];
  const blockValues: Record<string, bigint> = {};
  for (const def of model.blocks) {
    const raw = blockRaw(def, bid.blocks[def.id], local);
    if (raw == null) continue;
    const conv = toEvalCurrency(raw, bid.currency, model, rates);
    if (conv === "MISSING_RATE") {
      if (!local.includes(`MISSING_RATE:${bid.currency}`)) local.push(`MISSING_RATE:${bid.currency}`);
      continue;
    }
    blockValues[def.id] = conv;
  }
  if (local.length > 0) {
    for (const code of local) reasons.push({ bidderId: bid.bidderId, code });
    return null;
  }

  const adjustments: Record<string, bigint> = {};
  for (const adj of model.adjustments) {
    if (adj.exemptIfOrigin !== undefined && bid.origin === adj.exemptIfOrigin) { adjustments[adj.id] = 0n; continue; }
    const pct = parseDec(adj.pct, PCT_SCALE, { signed: true });
    if (pct == null) throw new ModelError(`adjustment ${adj.id}: invalid percentage`);
    let base = 0n;
    for (const id of adj.base) {
      const v = blockValues[id];
      if (v === undefined) throw new ModelError(`adjustment ${adj.id}: unknown base block ${id}`);
      base += v;
    }
    adjustments[adj.id] = rescale(base * pct, EVAL_SCALE + PCT_SCALE, EVAL_SCALE);
  }

  let scored = 0n, committed = 0n, estimated = 0n, info = 0n;
  for (const def of model.blocks) {
    const v = blockValues[def.id] ?? 0n;
    if (def.evaluation === "INFO") { info += v; continue; }
    scored += v;
    if (def.commitment === "COMMITTED") committed += v; else estimated += v;
  }
  const adjTotal = Object.values(adjustments).reduce((a, b) => a + b, 0n);
  const totalV = scored + adjTotal;
  const fmt = (v: bigint) => formatDec(v, EVAL_SCALE, false);
  return {
    totalV,
    result: {
      bidderId: bid.bidderId,
      blocks: Object.fromEntries(Object.entries(blockValues).map(([k, v]) => [k, fmt(v)])),
      adjustments: Object.fromEntries(Object.entries(adjustments).map(([k, v]) => [k, fmt(v)])),
      total: fmt(totalV),
      committed: fmt(committed),
      estimated: fmt(estimated),
      info: fmt(info),
    },
  };
}

interface Row { bidderId: string; tech: bigint; comm: bigint; comb: bigint; submittedAt: string }

function rankRows(rows: Row[]): Row[] {
  return rows.slice().sort((a, b) =>
    a.comb !== b.comb ? (a.comb > b.comb ? -1 : 1)
    : a.tech !== b.tech ? (a.tech > b.tech ? -1 : 1)
    : a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0);
}

function combine(wt: bigint, wc: bigint, tech: bigint, comm: bigint): bigint {
  // weights scale 4, scores scale 2 -> scale 6 -> back to scale 2
  return roundDiv(wt * tech + wc * comm, pow10(WEIGHT_SCALE));
}

function parseWeights(t: string, c: string): [bigint, bigint] {
  const wt = parseDec(t, WEIGHT_SCALE);
  const wc = parseDec(c, WEIGHT_SCALE);
  if (wt == null || wc == null || wt + wc !== pow10(WEIGHT_SCALE)) {
    throw new ModelError("weights must be decimal fractions that add up to 1");
  }
  return [wt, wc];
}

/**
 * Calculate one run for a set of qualified bidders.
 * @param technical bidderId -> technical score (scale 2) as a decimal string
 */
export function calculate(model: ModelDef, bids: BidInput[], rates: Rates, technical: Record<string, string>): CalcRun {
  const [wt, wc] = parseWeights(model.scoring.weights.technical, model.scoring.weights.commercial);
  const sens = model.sensitivityWeights.map(([t, c]) => ({ pair: [t, c] as [string, string], w: parseWeights(t, c) }));
  const reasons: Reason[] = [];
  const evaluated = new Map<string, Evaluated>();
  for (const bid of bids) {
    const e = evaluateBidder(model, bid, rates, reasons);
    if (e) evaluated.set(bid.bidderId, e);
  }
  const techScores = new Map<string, bigint>();
  for (const bid of bids) {
    const t = parseDec(technical[bid.bidderId], 2);
    if (t == null) reasons.push({ bidderId: bid.bidderId, code: "MISSING_TECHNICAL" });
    else techScores.set(bid.bidderId, t);
  }

  const inputHash = hashInputs({ model, bids, rates, technical });
  const base: CalcRun = {
    status: reasons.length ? "INCOMPLETE" : "COMPLETE",
    reasons,
    modelVersion: `${model.model}@${model.version}`,
    evaluationCurrency: model.evaluationCurrency,
    inputHash,
    bidders: [...evaluated.values()].map((e) => e.result),
  };
  if (reasons.length || bids.length === 0) {
    if (!bids.length) base.status = "INCOMPLETE", base.reasons.push({ code: "NO_BIDDERS" });
    return base;
  }

  const lowest = [...evaluated.values()].reduce((m, e) => (e.totalV < m ? e.totalV : m), [...evaluated.values()][0]!.totalV);
  if (lowest <= 0n) {
    return { ...base, status: "INCOMPLETE", reasons: [{ code: "NON_POSITIVE_LOWEST" }] };
  }

  const submitted = new Map(bids.map((b) => [b.bidderId, b.submittedAt ?? ""]));
  const rows: Row[] = bids.map((b) => {
    const tech = techScores.get(b.bidderId)!;
    const total = evaluated.get(b.bidderId)!.totalV;
    const comm = roundDiv(lowest * pow10(EVAL_SCALE + 2), total); // lowest/total*100, scale 2
    return { bidderId: b.bidderId, tech, comm, comb: combine(wt, wc, tech, comm), submittedAt: submitted.get(b.bidderId) ?? "" };
  });
  const ranked = rankRows(rows);
  const f2 = (v: bigint) => formatDec(v, 2, false);
  const scores: ScoreRow[] = ranked.map((r, i) => ({
    bidderId: r.bidderId, technical: f2(r.tech), commercial: f2(r.comm), combined: f2(r.comb), rank: i + 1,
  }));
  const manual = ranked.some((r, i) => i > 0 && ranked[i - 1]!.comb === r.comb && ranked[i - 1]!.tech === r.tech
    && ranked[i - 1]!.submittedAt === r.submittedAt);

  const marginV = ranked.length > 1 ? ranked[0]!.comb - ranked[1]!.comb : null;
  const closeMargin = parseDec(model.closeResultMargin, 2) ?? 0n;
  const threshold = model.technicalThreshold ? parseDec(model.technicalThreshold, 2) : null;
  const closeResult = {
    marginPoints: marginV == null ? "" : f2(marginV),
    flagged: marginV != null && marginV < closeMargin,
    ...(threshold != null
      ? { marginAboveThreshold: Object.fromEntries(rows.map((r) => [r.bidderId, f2(r.tech - threshold)])) }
      : {}),
  };
  const sensitivity = sens.map(({ pair, w }) => {
    const alt = rows.map((r) => ({ ...r, comb: combine(w[0], w[1], r.tech, r.comm) }));
    return {
      technical: pair[0], commercial: pair[1],
      ranking: rankRows(alt).map((r) => r.bidderId),
      combined: Object.fromEntries(alt.map((r) => [r.bidderId, f2(r.comb)])),
    };
  });
  return { ...base, scores, manualDecisionRequired: manual || undefined, closeResult, sensitivity };
}
