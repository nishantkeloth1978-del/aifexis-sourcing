import { formatDec, parseDec, rescale } from "@/engine/decimal";
import { meetsLimit, type LaneCol, type LaneGrid, type LaneTerms } from "@/bids/lanes";

/** Freight lanes side by side: what each qualified carrier asks for each lane, and what splitting the award would save. Pure. */
export interface LaneCell { priced: boolean; allIn: string; annual: string; terms: Record<string, string>; meets: boolean | null }
export interface LaneMatrixRow {
  key: string; no: number; name: string; quantity: string; buyer: Record<string, string>; lotNo: number | null;
  cells: Record<string, LaneCell>; lowest: string | null;          // supplier id with the lowest all-in price on this lane
}
export interface LaneScenario { supplierId: string | null; name: string; annual: string | null; lanesPriced: number; lanes: number }
export interface LaneMatrix {
  suppliers: { supplierId: string; name: string }[];
  buyerCols: LaneCol[]; nameKeys: string[]; answers: LaneCol[]; limit: LaneGrid["limit"];
  rows: LaneMatrixRow[];
  single: LaneScenario[];                                           // everything to one carrier, one entry per carrier
  bestSingle: LaneScenario | null;                                  // the cheapest carrier that priced every lane
  byLane: { annual: string | null; carriers: number; lanesCovered: number; lanes: number };
  saving: string | null;                                            // best single carrier minus lane by lane
}
export interface BidLines { supplierId: string; name: string; lines: { itemId: string; unitPrice: string; amount: string; noBid?: boolean }[]; terms: LaneTerms }

const f2 = (v: bigint) => formatDec(v, 2, false);

export function buildLaneMatrix(grid: LaneGrid, lotNos: Map<string, number>, bids: BidLines[]): LaneMatrix {
  const rows: LaneMatrixRow[] = grid.lanes.map((lane) => {
    const cells: Record<string, LaneCell> = {};
    let lowest: { id: string; v: bigint } | null = null;
    for (const b of bids) {
      const byItem = new Map(b.lines.map((l) => [l.itemId, l]));
      const mine = Object.values(lane.items).map((id) => byItem.get(id));
      const priced = mine.length > 0 && mine.every(Boolean);
      const terms = b.terms[lane.key] ?? {};
      if (!priced) { cells[b.supplierId] = { priced: false, allIn: "", annual: "", terms: {}, meets: null }; continue; }
      const allIn = mine.reduce<bigint>((a, l) => a + (l!.noBid ? 0n : parseDec(l!.unitPrice, 4) ?? 0n), 0n);
      const annual = mine.reduce<bigint>((a, l) => a + (parseDec(l!.amount, 2) ?? 0n), 0n);
      cells[b.supplierId] = { priced: true, allIn: f2(rescale(allIn, 4, 2)), annual: f2(annual), terms, meets: meetsLimit(grid, lane, terms) };
      if (!lowest || allIn < lowest.v) lowest = { id: b.supplierId, v: allIn };
    }
    return { key: lane.key, no: lane.no, name: lane.name, quantity: lane.quantity, buyer: lane.buyer, lotNo: lane.lotId ? lotNos.get(lane.lotId) ?? null : null, cells, lowest: lowest?.id ?? null };
  });
  const annualOf = (r: LaneMatrixRow, id: string) => parseDec(r.cells[id]?.annual ?? "", 2) ?? 0n;
  const single: LaneScenario[] = bids.map((b) => {
    const priced = rows.filter((r) => r.cells[b.supplierId]?.priced);
    return { supplierId: b.supplierId, name: b.name, annual: priced.length === rows.length ? f2(priced.reduce<bigint>((a, r) => a + annualOf(r, b.supplierId), 0n)) : null, lanesPriced: priced.length, lanes: rows.length };
  });
  const complete = single.filter((s) => s.annual !== null).sort((a, b) => (parseDec(a.annual!, 2)! < parseDec(b.annual!, 2)! ? -1 : 1));
  const covered = rows.filter((r) => r.lowest);
  const byLaneTotal = covered.reduce<bigint>((a, r) => a + annualOf(r, r.lowest!), 0n);
  const all = covered.length === rows.length && rows.length > 0;
  const best = complete[0] ?? null;
  return {
    suppliers: bids.map((b) => ({ supplierId: b.supplierId, name: b.name })), buyerCols: grid.buyerCols, nameKeys: grid.nameKeys, answers: grid.answers, limit: grid.limit,
    rows, single, bestSingle: best,
    byLane: { annual: all ? f2(byLaneTotal) : null, carriers: new Set(covered.map((r) => r.lowest)).size, lanesCovered: covered.length, lanes: rows.length },
    saving: all && best ? f2(parseDec(best.annual!, 2)! - byLaneTotal) : null,
  };
}
