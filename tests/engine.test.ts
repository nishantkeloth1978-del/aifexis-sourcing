import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { calculate, formatDec, parseDec, roundDiv, ModelError } from "@/engine";
import type { BidInput, ModelDef } from "@/engine";

const vectors: any[] = JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures/calc_test_vectors_v0_1.json"), "utf8"));
const vec = (id: string) => vectors.find((v) => v.id === id)!;

// ---------------------------------------------------------------- models and bids (Scenario 1 and 2)

const equipment: ModelDef = {
  model: "equipment_tco", version: 1, evaluationCurrency: "AED",
  blocks: [
    { id: "goods", type: "UNIT_PRICE", evaluation: "SCORED", commitment: "COMMITTED" },
    { id: "services", type: "LUMP_SUM", evaluation: "SCORED", commitment: "COMMITTED" },
    { id: "freight", type: "LUMP_SUM", evaluation: "SCORED", commitment: "COMMITTED", allowZero: true },
  ],
  adjustments: [{ id: "duty", base: ["goods", "freight"], pct: "0.05", exemptIfOrigin: "UAE" }],
  scoring: { method: "lowest_over_bid", weights: { technical: "0.60", commercial: "0.40" } },
  closeResultMargin: "1.00",
  sensitivityWeights: [["0.50", "0.50"], ["0.60", "0.40"], ["0.70", "0.30"]],
  technicalThreshold: "70.00",
};
const qtys = { L1: "2", L2: "4", L3: "2" };
function equipBid(id: string, currency: string, origin: string, p: Record<string, string>, freight: string): BidInput {
  return {
    bidderId: id, currency, origin,
    blocks: {
      goods: { lines: (["L1", "L2", "L3"] as const).map((k) => ({ id: k, unitPrice: p[k], qty: qtys[k], unit: "each", requiredUnit: "each" })) },
      services: { lines: [{ id: "L4", price: p.L4 }, { id: "L5", price: p.L5 }] },
      freight: { lines: [{ id: "FR", price: freight }] },
    },
  };
}
const equipBids = () => [
  equipBid("A", "EUR", "DE", { L1: "28000", L2: "1200", L3: "3500", L4: "18000", L5: "4000" }, "6500"),
  equipBid("B", "AED", "UAE", { L1: "118000", L2: "5200", L3: "15000", L4: "60000", L5: "15000" }, "0"),
  equipBid("C", "USD", "IN", { L1: "24500", L2: "950", L3: "2900", L4: "14000", L5: "2500" }, "5800"),
];
const rates = { USD: "3.6725", EUR: "4.30" };
const equipTech = { A: "84", B: "78", C: "72" };

const services: ModelDef = {
  model: "services", version: 1, evaluationCurrency: "AED",
  blocks: [
    { id: "ms", type: "LUMP_SUM", evaluation: "SCORED", commitment: "COMMITTED" },
    { id: "rc", type: "RATE_X_EST_QTY", evaluation: "SCORED", commitment: "ESTIMATED" },
    { id: "exp", type: "CAPPED_AMOUNT", evaluation: "SCORED", commitment: "ESTIMATED" },
  ],
  adjustments: [],
  scoring: { method: "lowest_over_bid", weights: { technical: "0.70", commercial: "0.30" } },
  closeResultMargin: "1.00",
  sensitivityWeights: [["0.50", "0.50"], ["0.60", "0.40"], ["0.70", "0.30"]],
  technicalThreshold: "70.00",
};
const hours = { LE: "400", INS: "1200", PL: "300" };
function svcBid(id: string, currency: string, ms: string[], r: { LE: string; INS: string; PL: string }, cap: string): BidInput {
  return {
    bidderId: id, currency,
    blocks: {
      ms: { lines: ms.map((p, i) => ({ id: `M${i + 1}`, price: p })) },
      rc: { lines: (["LE", "INS", "PL"] as const).map((k) => ({ id: k, rate: r[k], evalQty: hours[k] })) },
      exp: { cap, evaluatedPct: "1" },
    },
  };
}
const svcBids = () => [
  svcBid("P", "AED", ["40000", "220000", "60000", "30000"], { LE: "420", INS: "260", PL: "300" }, "25000"),
  svcBid("Q", "USD", ["12000", "70000", "20000", "9000"], { LE: "130", INS: "80", PL: "95" }, "8000"),
  svcBid("R", "AED", ["35000", "190000", "55000", "25000"], { LE: "480", INS: "300", PL: "340" }, "20000"),
];
const svcTech = { P: "82", Q: "88", R: "74" };

const byId = <T extends { bidderId: string }>(rows: T[] | undefined) => Object.fromEntries((rows ?? []).map((r) => [r.bidderId, r]));

describe("test vectors", () => {
  it("TV1: Scenario 1 equipment tender matches the shared vector file", () => {
    const run = calculate(equipment, equipBids(), rates, equipTech);
    expect(run.status).toBe("COMPLETE");
    const exp = vec("TV1");
    const scores = byId(run.scores);
    const bidders = byId(run.bidders);
    for (const id of ["A", "B", "C"]) {
      expect(bidders[id]!.total).toBe(exp.expect[id].tco);
      expect(scores[id]!.commercial).toBe(exp.expect[id].commercial);
      expect(scores[id]!.combined).toBe(exp.expect[id].combined);
    }
    expect(run.scores!.map((s) => s.bidderId)).toEqual(exp.rank);
    expect(bidders.A!.blocks.goods).toBe(exp.components.A.goods);
    expect(bidders.A!.adjustments.duty).toBe(exp.components.A.duty);
    expect(bidders.B!.adjustments.duty).toBe("0.00");
  });

  it("TV2: Scenario 2 services RFP with milestones, rate card and expense cap", () => {
    const run = calculate(services, svcBids(), rates, svcTech);
    expect(run.status).toBe("COMPLETE");
    const exp = vec("TV2");
    const scores = byId(run.scores);
    const bidders = byId(run.bidders);
    for (const id of ["P", "Q", "R"]) {
      expect(bidders[id]!.total).toBe(exp.expect[id].tco);
      expect(scores[id]!.commercial).toBe(exp.expect[id].commercial);
      expect(scores[id]!.combined).toBe(exp.expect[id].combined);
    }
    expect(run.scores!.map((s) => s.bidderId)).toEqual(exp.rank);
    // committed and estimated amounts are kept apart
    expect(bidders.Q!.committed).toBe("407647.50");
    expect(bidders.Q!.estimated).toBe("677576.25"); // 648,196.25 rate card + 29,380.00 expenses
  });

  it("TV2b: close result is flagged and the margin above the threshold is stored", () => {
    const run = calculate(services, svcBids(), rates, svcTech);
    expect(run.closeResult!.marginPoints).toBe("0.32");
    expect(run.closeResult!.flagged).toBe(true);
    expect(run.closeResult!.marginAboveThreshold!.R).toBe("4.00");
  });

  it("TV3: sensitivity table reproduces the 60/40 outcome without changing the official result", () => {
    const run = calculate(services, svcBids(), rates, svcTech);
    const exp = vec("TV3");
    const s6040 = run.sensitivity!.find((s) => s.technical === "0.60")!;
    for (const id of ["P", "Q", "R"]) expect(s6040.combined[id]).toBe(exp.expect[id].combined);
    expect(s6040.ranking).toEqual(exp.rank);
    expect(run.scores![0]!.bidderId).toBe("Q"); // official result stays at 70/30
  });

  it("TV4: rounds half up (banker's rounding would give 1.00)", () => {
    const model: ModelDef = { ...equipment, adjustments: [], blocks: [{ id: "x", type: "LUMP_SUM", evaluation: "SCORED", commitment: "COMMITTED" }] };
    const bid: BidInput = { bidderId: "X", currency: "XXX", blocks: { x: { lines: [{ price: "1.00" }] } } };
    const run = calculate(model, [bid], { XXX: "1.005" }, { X: "80" });
    expect(byId(run.bidders).X!.total).toBe(vec("TV4").expect);
  });

  it("TV5: a missing rate gives INCOMPLETE and no scores", () => {
    const run = calculate(equipment, equipBids(), { USD: "3.6725" }, equipTech);
    expect(run.status).toBe("INCOMPLETE");
    expect(run.reasons).toContainEqual({ bidderId: "A", code: "MISSING_RATE:EUR" });
    expect(run.scores).toBeUndefined();
    expect(vec("TV5").reason).toBe("MISSING_RATE:GBP");
  });

  it("TV6: a unit mismatch without a verified mapping gives INCOMPLETE; a mapping resolves it", () => {
    const bids = equipBids();
    (bids[1]!.blocks.goods as any).lines[0].unit = "set";
    let run = calculate(equipment, bids, rates, equipTech);
    expect(run.status).toBe("INCOMPLETE");
    expect(run.reasons).toContainEqual({ bidderId: "B", code: "UNIT_MISMATCH:L1" });
    (bids[1]!.blocks.goods as any).lines[0].unitMapped = true;
    run = calculate(equipment, bids, rates, equipTech);
    expect(run.status).toBe("COMPLETE");
  });

  it("TV7: a non-positive lowest total gives INCOMPLETE", () => {
    const model: ModelDef = { ...equipment, adjustments: [], blocks: [{ id: "x", type: "LUMP_SUM", evaluation: "SCORED", commitment: "COMMITTED", allowZero: true }] };
    const run = calculate(model, [{ bidderId: "X", currency: "AED", blocks: { x: { lines: [{ price: "0" }] } } }], {}, { X: "50" });
    expect(run.status).toBe("INCOMPLETE");
    expect(run.reasons).toContainEqual({ code: "NON_POSITIVE_LOWEST" });
  });

  it("TV8: equal combined scores rank the higher technical score first", () => {
    const model: ModelDef = { ...equipment, adjustments: [], blocks: [{ id: "x", type: "LUMP_SUM", evaluation: "SCORED", commitment: "COMMITTED" }], sensitivityWeights: [] };
    // X: cost 100 (comm 100), tech 80; Y: cost 125 (comm 80), tech 100 -> combined 0.6*80+0.4*100 = 88.00 and 0.6*100+0.4*80 = 92.00 (not equal)
    // choose weights 50/50 instead: X = 90.00, Y = 90.00
    const m2: ModelDef = { ...model, scoring: { method: "lowest_over_bid", weights: { technical: "0.50", commercial: "0.50" } } };
    const mk = (id: string, price: string): BidInput => ({ bidderId: id, currency: "AED", blocks: { x: { lines: [{ price }] } } });
    const run = calculate(m2, [mk("X", "100"), mk("Y", "125")], {}, { X: "80", Y: "100" });
    expect(run.scores!.map((s) => [s.bidderId, s.combined])).toEqual([["Y", "90.00"], ["X", "90.00"]]);
    expect(run.manualDecisionRequired).toBeUndefined();
  });

  it("TV9: a negative adjustment acts as a discount", () => {
    const model: ModelDef = { ...equipment, blocks: [{ id: "goods", type: "UNIT_PRICE", evaluation: "SCORED", commitment: "COMMITTED" }], adjustments: [{ id: "disc", base: ["goods"], pct: "-0.05" }], sensitivityWeights: [] };
    const bid: BidInput = { bidderId: "X", currency: "AED", blocks: { goods: { lines: [{ unitPrice: "50000", qty: "2" }] } } };
    const run = calculate(model, [bid], {}, { X: "80" });
    const r = byId(run.bidders).X!;
    expect(r.adjustments.disc).toBe("-5000.00");
    expect(r.total).toBe("95000.00");
  });

  it("TV10: an INFO block is shown but excluded from totals and scores", () => {
    const model: ModelDef = { ...equipment, adjustments: [], sensitivityWeights: [], blocks: [
      { id: "ms", type: "LUMP_SUM", evaluation: "SCORED", commitment: "COMMITTED" },
      { id: "opt", type: "LUMP_SUM", evaluation: "INFO", commitment: "ESTIMATED" },
    ] };
    const bid: BidInput = { bidderId: "X", currency: "AED", blocks: { ms: { lines: [{ price: "1000" }] }, opt: { lines: [{ price: "500" }] } } };
    const r = byId(calculate(model, [bid], {}, { X: "80" }).bidders).X!;
    expect(r.total).toBe("1000.00");
    expect(r.info).toBe("500.00");
  });
});

describe("validation and edge cases", () => {
  it("an unpriced required block is INCOMPLETE", () => {
    const bids = equipBids();
    delete (bids[2]!.blocks as any).services;
    const run = calculate(equipment, bids, rates, equipTech);
    expect(run.reasons).toContainEqual({ bidderId: "C", code: "UNPRICED_BLOCK:services" });
  });
  it("a zero price is rejected unless the block allows zero (freight does)", () => {
    const bids = equipBids();
    (bids[1]!.blocks.goods as any).lines[1].unitPrice = "0";
    const run = calculate(equipment, bids, rates, equipTech);
    expect(run.reasons).toContainEqual({ bidderId: "B", code: "ZERO_NOT_ALLOWED:L2" });
    expect(calculate(equipment, equipBids(), rates, equipTech).status).toBe("COMPLETE"); // B freight is 0
  });
  it("invalid numbers are rejected, not coerced", () => {
    const bids = equipBids();
    (bids[0]!.blocks.services as any).lines[0].price = "18 000";
    const run = calculate(equipment, bids, rates, equipTech);
    expect(run.reasons).toContainEqual({ bidderId: "A", code: "INVALID_NUMBER:L4" });
  });
  it("a missing technical score is INCOMPLETE", () => {
    const run = calculate(equipment, equipBids(), rates, { A: "84", B: "78" });
    expect(run.reasons).toContainEqual({ bidderId: "C", code: "MISSING_TECHNICAL" });
  });
  it("weights that do not add up to 1 are a model error", () => {
    const bad: ModelDef = { ...equipment, scoring: { method: "lowest_over_bid", weights: { technical: "0.60", commercial: "0.30" } } };
    expect(() => calculate(bad, equipBids(), rates, equipTech)).toThrow(ModelError);
  });
  it("identical bidders on every tie-break require a manual decision", () => {
    const mk = (id: string): BidInput => ({ bidderId: id, currency: "AED", submittedAt: "2026-10-06T10:00:00Z", blocks: { x: { lines: [{ price: "100" }] } } });
    const model: ModelDef = { ...equipment, adjustments: [], sensitivityWeights: [], blocks: [{ id: "x", type: "LUMP_SUM", evaluation: "SCORED", commitment: "COMMITTED" }] };
    const run = calculate(model, [mk("X"), mk("Y")], {}, { X: "80", Y: "80" });
    expect(run.manualDecisionRequired).toBe(true);
  });
  it("the earlier submission wins the last tie-break", () => {
    const mk = (id: string, at: string): BidInput => ({ bidderId: id, currency: "AED", submittedAt: at, blocks: { x: { lines: [{ price: "100" }] } } });
    const model: ModelDef = { ...equipment, adjustments: [], sensitivityWeights: [], blocks: [{ id: "x", type: "LUMP_SUM", evaluation: "SCORED", commitment: "COMMITTED" }] };
    const run = calculate(model, [mk("X", "2026-10-06T11:00:00Z"), mk("Y", "2026-10-06T10:00:00Z")], {}, { X: "80", Y: "80" });
    expect(run.scores![0]!.bidderId).toBe("Y");
  });
  it("decimal helpers: parse, format and round", () => {
    expect(parseDec("1,234.50", 2)).toBe(123450n);
    expect(parseDec("1.234", 2)).toBeNull();
    expect(parseDec("-1", 2)).toBeNull();
    expect(parseDec("-0.05", 6, { signed: true })).toBe(-50000n);
    expect(formatDec(123456789n, 2)).toBe("1,234,567.89");
    expect(roundDiv(5n, 10n)).toBe(1n);
    expect(roundDiv(-5n, 10n)).toBe(-1n);
    expect(roundDiv(4n, 10n)).toBe(0n);
  });
});

describe("property tests", () => {
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const randBids = (r: () => number) =>
    ["A", "B", "C", "D"].map((id) => equipBid(id, ["AED", "USD", "EUR"][Math.floor(r() * 3)]!, ["UAE", "IN", "DE"][Math.floor(r() * 3)]!, {
      L1: String(1000 + Math.floor(r() * 90000)), L2: String(100 + Math.floor(r() * 5000)), L3: String(100 + Math.floor(r() * 9000)),
      L4: String(1000 + Math.floor(r() * 30000)), L5: String(500 + Math.floor(r() * 9000)),
    }, String(Math.floor(r() * 9000))));
  const tech = { A: "81", B: "77.5", C: "90", D: "72.25" };

  it("recomputation is identical (same inputs, same hash, same outputs)", () => {
    const r = rng(7);
    for (let i = 0; i < 50; i++) {
      const bids = randBids(r);
      const a = calculate(equipment, bids, rates, tech);
      const b = calculate(equipment, structuredClone(bids), rates, tech);
      expect(b).toEqual(a);
    }
  });
  it("order of bidders does not change totals or ranking", () => {
    const r = rng(11);
    for (let i = 0; i < 50; i++) {
      const bids = randBids(r);
      const a = calculate(equipment, bids, rates, tech);
      const b = calculate(equipment, bids.slice().reverse(), rates, tech);
      expect(b.scores!.map((s) => s.bidderId)).toEqual(a.scores!.map((s) => s.bidderId));
      expect(byId(b.bidders)).toEqual(byId(a.bidders));
    }
  });
  it("lowering a bidder's price never lowers its commercial score", () => {
    const r = rng(23);
    for (let i = 0; i < 50; i++) {
      const bids = randBids(r);
      const before = byId(calculate(equipment, bids, rates, tech).scores)["B"]!;
      const cheaper = structuredClone(bids);
      (cheaper[1]!.blocks.services as any).lines[0].price = "1000";
      const after = byId(calculate(equipment, cheaper, rates, tech).scores)["B"]!;
      expect(Number(after.commercial)).toBeGreaterThanOrEqual(Number(before.commercial));
    }
  });
  it("totals reconcile by hand: blocks plus adjustments equal the total", () => {
    const r = rng(31);
    for (let i = 0; i < 50; i++) {
      const run = calculate(equipment, randBids(r), rates, tech);
      for (const b of run.bidders) {
        const sum = Object.values(b.blocks).concat(Object.values(b.adjustments)).reduce((a, v) => a + parseDec(v, 2)!, 0n);
        expect(formatDec(sum, 2, false)).toBe(b.total);
      }
    }
  });
  it("adding an INFO block never changes totals or ranking", () => {
    const withInfo: ModelDef = { ...equipment, blocks: [...equipment.blocks, { id: "opt", type: "LUMP_SUM", evaluation: "INFO", commitment: "ESTIMATED" }] };
    const r = rng(41);
    for (let i = 0; i < 30; i++) {
      const bids = randBids(r);
      const withOpt = bids.map((b) => ({ ...b, blocks: { ...b.blocks, opt: { lines: [{ price: String(1 + Math.floor(r() * 99999)) }] } } }));
      const a = calculate(equipment, bids, rates, tech);
      const b = calculate(withInfo, withOpt, rates, tech);
      expect(b.scores).toEqual(a.scores);
      expect(b.bidders.map((x) => x.total)).toEqual(a.bidders.map((x) => x.total));
    }
  });
  it("any missing required input gives INCOMPLETE, never a number", () => {
    const bids = equipBids();
    for (const drop of ["goods", "services", "freight"]) {
      const b = structuredClone(bids);
      delete (b[0]!.blocks as any)[drop];
      const run = calculate(equipment, b, rates, equipTech);
      expect(run.status).toBe("INCOMPLETE");
      expect(run.scores).toBeUndefined();
    }
  });
});
