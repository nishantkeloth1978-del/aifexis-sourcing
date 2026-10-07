import type { Pool, PoolClient } from "pg";
import { applyTransition, audit, loadSubject, readBidItems, readCalculationRuns, readTechResults, withTenant, type Actor } from "@/authz";
import { formatDec, hashInputs, parseDec, roundDiv } from "@/engine";
import { resolveConfig, type EvalConfig } from "@/config/service";
import type { Who } from "@/events/service";


export type ComOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface RankRow { supplierId: string; name: string; tech: string; total: string; commercial: string; final: string; rank: number }
export interface LineRow { lineNo: number; description: string; unit: string; quantity: string; byBid: Record<string, { unitPrice: string; amount: string }> }
export interface Comparison { currency: string; weights: { technical: number; commercial: number }; rows: RankRow[]; lines: LineRow[]; closeResult: boolean }
export interface ComView {
  state: string; stateVersion: number; roles: string[];
  witnesses: { membershipId: string; email: string }[];
  comparison: Comparison | null; stored: boolean;
  recommendation: { supplierId: string; name: string; note: string } | null;
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

async function computeComparison(c: PoolClient, actor: Actor, eventId: string): Promise<Comparison | null> {
  const cfg: EvalConfig = await resolveConfig(c, eventId);
  const WT = BigInt(cfg.weights.technical), WC = BigInt(cfg.weights.commercial), MARGIN = BigInt(Math.round(cfg.closeMargin * 100));
  const [items, techResults] = [await readBidItems(c, actor, eventId), await readTechResults(c, actor, eventId)];
  const qualified = techResults.filter((t) => t.qualified);
  const prices = items.filter((i) => i.dataClass === "D7" && i.kind === "price_lines");
  if (!qualified.length || !prices.length) return null;
  const names = new Map((await c.query(`select id, name from supplier_org`)).rows.map((r) => [r.id as string, r.name as string]));
  const bids = qualified.map((q) => ({ q, p: prices.find((p) => p.supplierId === q.supplier_id)?.payload as { currency?: string; total?: string; lines?: { lineNo: number; unitPrice: string; amount: string }[] } | undefined }))
    .filter((b) => b.p?.total);
  if (!bids.length) return null;
  const lowest = bids.map((b) => dec2(b.p!.total)).reduce((a, b) => (a < b ? a : b));
  const scored = bids.map((b) => {
    const total = dec2(b.p!.total);
    const commercial = roundDiv(lowest * 10000n, total);                     // lowest bid / this bid x 100, two decimals
    const tech = dec2(Number(b.q.total).toFixed(2));
    const final = roundDiv(WT * tech + WC * commercial, 100n);
    return { b, total, commercial, tech, final };
  }).sort((x, y) => (y.final > x.final ? 1 : y.final < x.final ? -1 : x.total < y.total ? -1 : 1));
  const rows: RankRow[] = scored.map((s, i) => ({
    supplierId: s.b.q.supplier_id, name: names.get(s.b.q.supplier_id) ?? "", tech: formatDec(s.tech, 2, false), total: formatDec(s.total, 2, false),
    commercial: formatDec(s.commercial, 2, false), final: formatDec(s.final, 2, false), rank: i + 1,
  }));
  const evItems = (await c.query(`select line_no, description, unit, quantity::text as quantity from event_item where event_id = $1 order by line_no`, [eventId])).rows;
  const lines: LineRow[] = evItems.map((it) => ({
    lineNo: it.line_no, description: it.description, unit: it.unit, quantity: it.quantity,
    byBid: Object.fromEntries(bids.map((b) => { const l = b.p!.lines?.find((x) => x.lineNo === it.line_no); return [b.q.supplier_id, { unitPrice: l?.unitPrice ?? "-", amount: l?.amount ?? "-" }]; })),
  }));
  const close = scored.length > 1 && scored[0]!.final - scored[1]!.final < MARGIN;
  return { currency: bids[0]!.p!.currency ?? "", weights: { ...cfg.weights }, rows, lines, closeResult: close };
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
    const recRow = reachedRec && (subject.effectiveRoles.has("buyer") || subject.effectiveRoles.has("comm_evaluator") || subject.effectiveRoles.has("award_approver") || subject.effectiveRoles.has("auditor"))
      ? (await c.query(`select r.supplier_id, s.name, r.note from recommendation r join supplier_org s on s.tenant_id = r.tenant_id and s.id = r.supplier_id where r.event_id = $1 order by r.created_at desc limit 1`, [eventId])).rows[0] : null;
    const ap = (await c.query(`select count(*)::int as n, bool_or(approver_membership_id = $2) as mine from approval where event_id = $1 and step = 'award' and decision = 'approve'`, [eventId, who.membershipId])).rows[0];
    return {
      state: ev.state, stateVersion: ev.state_version, roles: [...subject.effectiveRoles] as string[], witnesses, comparison, stored,
      recommendation: recRow ? { supplierId: recRow.supplier_id, name: recRow.name, note: recRow.note } : null,
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

export async function recordRecommendation(pool: Pool, who: Who, eventId: string, version: number, supplierId: string, note: string): Promise<ComOut> {
  const text = (note ?? "").trim();
  if (text.length < 10) return { ok: false, error: "Write the reason for the recommendation (at least 10 characters)." };
  return withTenant(pool, who.tenantId, async (c) => {
    const actor = internal(who);
    const comparison = await computeComparison(c, actor, eventId);
    if (!comparison) return { ok: false as const, error: "There is no commercial comparison to recommend from." };
    if (!comparison.rows.some((r) => r.supplierId === supplierId)) return { ok: false as const, error: "Recommend one of the qualified bidders." };
    const res = await applyTransition(c, actor, eventId, "RecordRecommendation", { expectedVersion: version });
    if (!res.ok) return { ok: false as const, error: why(res.decision.reason) };
    const inputs = { eventId, rows: comparison.rows, weights: comparison.weights };
    const runId = (await c.query(
      `insert into calculation_run (tenant_id, event_id, model_version, status, input_hash, inputs, outputs) values ($1,$2,'weighted-lowest-1','COMPLETE',$3,$4,$5) returning id`,
      [who.tenantId, eventId, hashInputs(inputs), JSON.stringify(inputs), JSON.stringify(comparison)])).rows[0].id;
    await c.query(`insert into recommendation (tenant_id, event_id, supplier_id, note, calculation_run_id, created_by) values ($1,$2,$3,$4,$5,$6)`, [who.tenantId, eventId, supplierId, text, runId, who.membershipId]);
    await audit(c, actor, eventId, "recommendation.recorded", { supplierId });
    return { ok: true as const };
  });
}

export const submitForAward = (pool: Pool, who: Who, eventId: string, version: number) => run(pool, who, eventId, "SubmitForAward", version, {});
export const approveAwardNow = (pool: Pool, who: Who, eventId: string, version: number) =>
  run(pool, who, eventId, "ApproveAward", version, { idempotencyKey: `award:${eventId}:${who.membershipId}:${version}` });
export const rejectAward = (pool: Pool, who: Who, eventId: string, version: number) => run(pool, who, eventId, "RejectAward", version, {});
