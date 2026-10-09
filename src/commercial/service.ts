import type { Pool, PoolClient } from "pg";
import { applyTransition, audit, loadSubject, readBidItems, readCalculationRuns, readTechResults, withTenant, type Actor } from "@/authz";
import { formatDec, hashInputs, parseDec, roundDiv } from "@/engine";
import { resolveConfig, type EvalConfig } from "@/config/service";
import type { Who } from "@/events/service";
import { currentAwards, lotsOf } from "@/lots/service";
import { extraOf, fmt2, listAssumptions, type Assumption } from "./assumptions";


export type ComOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface RankRow { supplierId: string; name: string; tech: string; total: string; commercial: string; final: string; rank: number; bid?: string; extras?: { label: string; amount: string }[] }
export interface LineRow { section?: string | null; lineNo: number; description: string; unit: string; quantity: string; byBid: Record<string, { unitPrice: string; amount: string }> }
export interface LotComparison { lotId: string; lotNo: number; name: string; rows: RankRow[]; lines: LineRow[]; closeResult: boolean }
/** Without lots, rows and lines are the ranking. With lots they are empty and each lot carries its own ranking. */
export interface AltRow { supplierId: string; name: string; label: string; note: string; bid: string; total: string; final: string; rankIfAccepted: number; mainRank: number; difference: string }
export interface BundleRow { supplierId: string; name: string; lotIds: string[]; lotNos: number[]; discountPct: string; lotsTotal: string; saving: string; net: string }
export interface Comparison { currency: string; weights: { technical: number; commercial: number }; rows: RankRow[]; lines: LineRow[]; closeResult: boolean; lots?: LotComparison[]; assumptions?: Assumption[]; missing?: string[]; alternates?: AltRow[]; bundles?: BundleRow[] }
export interface LotAward { lotId: string; lotNo: number; lotName: string; supplierId: string; name: string }
export interface ComView {
  state: string; stateVersion: number; roles: string[];
  witnesses: { membershipId: string; email: string }[];
  comparison: Comparison | null; stored: boolean;
  recommendation: { supplierId: string; name: string; note: string } | null;
  lotAwards: LotAward[];
  approvals: { done: number; required: number; mine: boolean };
}

const internal = (w: Who): Actor => ({ kind: "internal", userId: w.userId, tenantId: w.tenantId });
const REASON: Record<string, string> = {
  BAD_STATE: "The event is not in the right state for that.", STALE_VERSION: "The event changed while you were looking. Reload and try again.",
  FORBIDDEN_ROLE: "You do not have the required role on this event.", SOD_VIOLATION: "You cannot approve an event you are evaluating or buying for.",
  NOT_FOUND: "Event not found.", WITNESS_REQUIRED: "Choose a witness assigned to this event.",
};
const why = (r: string) => REASON[r] ?? "That is not allowed.";
const dec2 = (s: unknown) => parseDec(String(s ?? ""), 2) ?? 0n;

interface PriceP { currency?: string; total?: string; lines?: { lineNo: number; unitPrice: string; amount: string }[]; lots?: { lotId: string; total: string }[]; alternates?: { label: string; note: string; total: string }[]; bundles?: { lotIds: string[]; lotNos: number[]; discountPct: string }[] }
type Qual = { supplier_id: string; total: number | string };
type Bid = { q: Qual; p: PriceP; total: bigint; bid?: bigint; extras?: { label: string; amount: bigint }[] };

/** Score and rank one set of bids: technical x weight + (lowest price / price x 100) x weight. */
function rankBids(bids: Bid[], names: Map<string, string>, WT: bigint, WC: bigint, MARGIN: bigint): { rows: RankRow[]; close: boolean } {
  if (!bids.length) return { rows: [], close: false };
  const lowest = bids.map((b) => b.total).reduce((a, b) => (a < b ? a : b));
  const scored = bids.map((b) => {
    const commercial = roundDiv(lowest * 10000n, b.total);                   // lowest bid / this bid x 100, two decimals
    const tech = dec2(Number(b.q.total).toFixed(2));
    const final = roundDiv(WT * tech + WC * commercial, 100n);
    return { b, total: b.total, commercial, tech, final };
  }).sort((x, y) => (y.final > x.final ? 1 : y.final < x.final ? -1 : x.total < y.total ? -1 : 1));
  const rows: RankRow[] = scored.map((s, i) => ({
    supplierId: s.b.q.supplier_id, name: names.get(s.b.q.supplier_id) ?? "", tech: formatDec(s.tech, 2, false), total: formatDec(s.total, 2, false),
    commercial: formatDec(s.commercial, 2, false), final: formatDec(s.final, 2, false), rank: i + 1,
    ...(s.b.extras?.length ? { bid: formatDec(s.b.bid!, 2, false), extras: s.b.extras.map((e) => ({ label: e.label, amount: formatDec(e.amount, 2, false) })) } : {}),
  }));
  return { rows, close: scored.length > 1 && scored[0]!.final - scored[1]!.final < MARGIN };
}

async function computeComparison(c: PoolClient, actor: Actor, eventId: string): Promise<Comparison | null> {
  const cfg: EvalConfig = await resolveConfig(c, eventId);
  const WT = BigInt(cfg.weights.technical), WC = BigInt(cfg.weights.commercial), MARGIN = BigInt(Math.round(cfg.closeMargin * 100));
  const [items, techResults] = [await readBidItems(c, actor, eventId), await readTechResults(c, actor, eventId)];
  const qualified = techResults.filter((t) => t.qualified);
  const prices = items.filter((i) => i.dataClass === "D7" && i.kind === "price_lines");
  if (!qualified.length || !prices.length) return null;
  const names = new Map((await c.query(`select id, name from supplier_org`)).rows.map((r) => [r.id as string, r.name as string]));
  const have = qualified.map((q) => ({ q: q as Qual, p: prices.find((p) => p.supplierId === q.supplier_id)?.payload as PriceP | undefined })).filter((b) => b.p?.total);
  if (!have.length) return null;
  const currency = have[0]!.p!.currency ?? "";
  const evItems = (await c.query(`select line_no, description, unit, quantity::text as quantity, lot_id, section from event_item where event_id = $1 order by line_no`, [eventId])).rows;
  const lineRows = (its: typeof evItems, bids: Bid[]): LineRow[] => its.map((it) => ({
    section: (it.section as string | null) ?? null, lineNo: it.line_no, description: it.description, unit: it.unit, quantity: it.quantity,
    byBid: Object.fromEntries(bids.map((b) => { const l = b.p.lines?.find((x) => x.lineNo === it.line_no); return [b.q.supplier_id, { unitPrice: l?.unitPrice ?? "-", amount: l?.amount ?? "-" }]; })),
  }));
  const lots = await lotsOf(c, eventId);
  if (lots.length) {
    const perLot: LotComparison[] = lots.map((lot) => {
      const bids: Bid[] = have.flatMap((b) => { const t = b.p!.lots?.find((x) => x.lotId === lot.id)?.total; return t ? [{ q: b.q, p: b.p!, total: dec2(t) }] : []; });
      const r = rankBids(bids, names, WT, WC, MARGIN);
      return { lotId: lot.id, lotNo: lot.lotNo, name: lot.name, rows: r.rows, lines: lineRows(evItems.filter((i) => i.lot_id === lot.id), bids), closeResult: r.close };
    });
    if (!perLot.some((l) => l.rows.length)) return null;
    const bundles: BundleRow[] = [];
    for (const b of have) for (const bd of b.p!.bundles ?? []) {
      const tot = bd.lotIds.reduce<bigint>((a, id) => a + dec2(b.p!.lots?.find((x) => x.lotId === id)?.total), 0n);
      if (tot === 0n) continue;
      const saving = roundDiv(tot * (parseDec(bd.discountPct, 2) ?? 0n), 10000n);
      bundles.push({ supplierId: b.q.supplier_id, name: names.get(b.q.supplier_id) ?? "", lotIds: bd.lotIds, lotNos: bd.lotNos, discountPct: bd.discountPct, lotsTotal: formatDec(tot, 2, false), saving: formatDec(saving, 2, false), net: formatDec(tot - saving, 2, false) });
    }
    return { currency, weights: { ...cfg.weights }, rows: [], lines: [], closeResult: false, lots: perLot, ...(bundles.length ? { bundles } : {}) };
  }
  const assumptions = await listAssumptions(c, eventId);
  const missing: string[] = [];
  const bids: Bid[] = have.map((b) => {
    const bid = dec2(b.p!.total); let total = bid; const extras: { label: string; amount: bigint }[] = [];
    for (const a of assumptions) {
      const v = a.values[b.q.supplier_id];
      if (v === undefined) { missing.push(`${names.get(b.q.supplier_id) ?? ""}: ${a.label}`); continue; }
      const amount = extraOf(a.kind, v, bid); total += amount; extras.push({ label: a.label, amount });
    }
    return { q: b.q, p: b.p!, total, bid, extras };
  });
  const r = rankBids(bids, names, WT, WC, MARGIN);
  // Alternate offers are ranked as if each replaced its supplier's main offer. They are never awarded as they stand.
  const alternates: AltRow[] = [];
  for (const b of bids) for (const alt of b.p.alternates ?? []) {
    const bid = dec2(alt.total); let total = bid;
    for (const a of assumptions) { const v = a.values[b.q.supplier_id]; if (v !== undefined) total += extraOf(a.kind, v, bid); }
    const what = rankBids(bids.map((x) => (x === b ? { ...x, total } : x)), names, WT, WC, MARGIN).rows.find((x) => x.supplierId === b.q.supplier_id)!;
    alternates.push({ supplierId: b.q.supplier_id, name: names.get(b.q.supplier_id) ?? "", label: alt.label, note: alt.note, bid: formatDec(bid, 2, false), total: formatDec(total, 2, false), final: what.final, rankIfAccepted: what.rank, mainRank: r.rows.find((x) => x.supplierId === b.q.supplier_id)?.rank ?? 0, difference: formatDec(total - b.total, 2, false) });
  }
  return { currency, weights: { ...cfg.weights }, rows: r.rows, lines: lineRows(evItems, bids), closeResult: r.close, ...(assumptions.length ? { assumptions, missing } : {}), ...(alternates.length ? { alternates } : {}) };
}

export async function getCommercialView(pool: Pool, who: Who, eventId: string): Promise<ComView | null> {
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state, state_version, required_award_approvals as req from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev) return null;
    const subject = await loadSubject(c, who.userId, eventId);
    const actor = internal(who);
    const witnesses = (await c.query(`select em.membership_id, u.email from event_member em join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id
                                        join app_user u on u.id = m.user_id where em.event_id = $1 and em.event_role = 'witness' order by u.email`, [eventId]))
      .rows.map((r) => ({ membershipId: r.membership_id as string, email: r.email as string }));
    let comparison = await computeComparison(c, actor, eventId);   // live, only for those allowed to read the prices
    let stored = false;
    if (!comparison) {
      const runs = await readCalculationRuns(c, actor, eventId);   // otherwise the stored run, if this role may read it
      const last = runs[runs.length - 1];
      if (last?.outputs) { comparison = last.outputs as Comparison; stored = true; }
    }
    const reachedRec = ["recommended", "pending_award", "awarded"].includes(ev.state);
    const mayRead = subject.effectiveRoles.has("buyer") || subject.effectiveRoles.has("comm_evaluator") || subject.effectiveRoles.has("award_approver") || subject.effectiveRoles.has("auditor");
    const awards = reachedRec && mayRead ? await currentAwards(c, eventId) : [];
    const first = awards[0];
    const ap = (await c.query(`select count(*)::int as n, bool_or(approver_membership_id = $2) as mine from approval where event_id = $1 and step = 'award' and decision = 'approve'`, [eventId, who.membershipId])).rows[0];
    return {
      state: ev.state, stateVersion: ev.state_version, roles: [...subject.effectiveRoles] as string[], witnesses, comparison, stored,
      recommendation: first ? { supplierId: first.supplierId, name: first.supplierName, note: first.note } : null,
      lotAwards: awards.filter((a) => a.lotId).map((a) => ({ lotId: a.lotId!, lotNo: a.lotNo!, lotName: a.lotName!, supplierId: a.supplierId, name: a.supplierName })),
      approvals: { done: ap.n, required: ev.req, mine: Boolean(ap.mine) },
    };
  });
}

async function run(pool: Pool, who: Who, eventId: string, command: string, version: number, payload: Parameters<typeof applyTransition>[4]["payload"], after?: (c: PoolClient) => Promise<ComOut>): Promise<ComOut> {
  return withTenant(pool, who.tenantId, async (c) => {
    const res = await applyTransition(c, internal(who), eventId, command, { expectedVersion: version, payload });
    if (!res.ok) return { ok: false as const, error: why(res.decision.reason) };
    return after ? after(c) : { ok: true as const };
  });
}

export const openCommercialEnvelopes = (pool: Pool, who: Who, eventId: string, version: number, witnessMembershipId: string) =>
  run(pool, who, eventId, "OpenEnvelope2", version, { witnessMembershipId });

/** One supplier for the event, or (when the event has lots) one supplier for each lot that has qualified bids. */
export async function recordRecommendation(pool: Pool, who: Who, eventId: string, version: number, pick: string | Record<string, string>, note: string): Promise<ComOut> {
  const text = (note ?? "").trim();
  if (text.length < 10) return { ok: false, error: "Write the reason for the recommendation (at least 10 characters)." };
  return withTenant(pool, who.tenantId, async (c) => {
    const actor = internal(who);
    const comparison = await computeComparison(c, actor, eventId);
    if (!comparison) return { ok: false as const, error: "There is no commercial comparison to recommend from." };
    if (comparison.missing?.length) return { ok: false as const, error: "Fill in every evaluation assumption for every qualified bidder before recommending." };
    const awards: { lotId: string | null; supplierId: string }[] = [];
    if (comparison.lots) {
      if (typeof pick === "string") return { ok: false as const, error: "Choose a supplier for each lot." };
      for (const k of Object.keys(pick)) if (!comparison.lots.some((l) => l.lotId === k)) return { ok: false as const, error: "That lot is not on this event." };
      for (const lot of comparison.lots) {
        const sid = pick[lot.lotId];
        if (!lot.rows.length) { if (sid) return { ok: false as const, error: `Lot ${lot.lotNo} has no qualified bids, so it cannot be awarded.` }; continue; }
        if (!sid) return { ok: false as const, error: `Choose a supplier for lot ${lot.lotNo}.` };
        if (!lot.rows.some((r) => r.supplierId === sid)) return { ok: false as const, error: `Recommend one of the qualified bidders for lot ${lot.lotNo}.` };
        awards.push({ lotId: lot.lotId, supplierId: sid });
      }
    } else {
      if (typeof pick !== "string") return { ok: false as const, error: "Recommend one of the qualified bidders." };
      if (!comparison.rows.some((r) => r.supplierId === pick)) return { ok: false as const, error: "Recommend one of the qualified bidders." };
      awards.push({ lotId: null, supplierId: pick });
    }
    const res = await applyTransition(c, actor, eventId, "RecordRecommendation", { expectedVersion: version });
    if (!res.ok) return { ok: false as const, error: why(res.decision.reason) };
    const inputs = { eventId, rows: comparison.rows, lots: comparison.lots, weights: comparison.weights };
    const runId = (await c.query(
      `insert into calculation_run (tenant_id, event_id, model_version, status, input_hash, inputs, outputs) values ($1,$2,'weighted-lowest-1','COMPLETE',$3,$4,$5) returning id`,
      [who.tenantId, eventId, hashInputs(inputs), JSON.stringify(inputs), JSON.stringify(comparison)])).rows[0].id;
    // All rows of one recommendation share the transaction time; that is how the current set is told apart from older ones.
    for (const a of awards) {
      await c.query(`insert into recommendation (tenant_id, event_id, supplier_id, lot_id, note, calculation_run_id, created_by) values ($1,$2,$3,$4,$5,$6,$7)`, [who.tenantId, eventId, a.supplierId, a.lotId, text, runId, who.membershipId]);
    }
    await audit(c, actor, eventId, "recommendation.recorded", awards.length === 1 && !awards[0]!.lotId ? { supplierId: awards[0]!.supplierId } : { awards });
    return { ok: true as const };
  });
}

export const submitForAward = (pool: Pool, who: Who, eventId: string, version: number) => run(pool, who, eventId, "SubmitForAward", version, {});
export const approveAwardNow = (pool: Pool, who: Who, eventId: string, version: number) =>
  run(pool, who, eventId, "ApproveAward", version, { idempotencyKey: `award:${eventId}:${who.membershipId}:${version}` });
export const rejectAward = (pool: Pool, who: Who, eventId: string, version: number) => run(pool, who, eventId, "RejectAward", version, {});
