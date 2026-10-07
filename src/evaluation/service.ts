import type { Pool, PoolClient } from "pg";
import { applyTransition, audit, loadSubject, readBidItems, withTenant, type Actor } from "@/authz";
import { DEFAULT_CONFIG, resolveConfig } from "@/config/service";
import type { Who } from "@/events/service";

/** Technical criteria, each scored 0 to 10 by every technical evaluator. Per-event criteria come with the configuration stage. */
export const CRITERIA = DEFAULT_CONFIG.criteria;

export type EvalOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface Bidder { supplierId: string; name: string; revisionNo: number; technicalText: string }
export interface ResultRow { supplierId: string; name: string; total: number | null; evaluators: number; suggested: boolean; qualified?: boolean }
export interface EvalView {
  state: string; stateVersion: number; closesAt: string | null;
  roles: string[]; isAdmin: boolean;
  bidderCount: number | null;                 // null when this person may not see it
  witnesses: { membershipId: string; email: string }[];
  bidders: Bidder[] | null;                   // null until the technical envelope is open and the person may read it
  myScores: Record<string, Record<string, number>>;
  results: ResultRow[] | null;
  criteria: readonly string[]; qualifyAt: number;
}

const internal = (w: Who): Actor => ({ kind: "internal", userId: w.userId, tenantId: w.tenantId });
const REASON: Record<string, string> = {
  BAD_STATE: "The event is not in the right state for that.", STALE_VERSION: "The event changed while you were looking. Reload and try again.",
  FORBIDDEN_ROLE: "You do not have the required role on this event.", SOD_VIOLATION: "You cannot approve a result on an event you are evaluating or buying for.",
  NOT_FOUND: "Event not found.", WITNESS_REQUIRED: "Choose a witness assigned to this event.", DEADLINE_NOT_REACHED: "The closing time has not been reached.",
  INVALID_QUALIFIED_LIST: "Choose at least one bidder, from those who submitted a bid.",
};
const why = (r: string) => REASON[r] ?? "That is not allowed.";

const round2 = (n: number) => Math.round(n * 100) / 100;

async function bidderRows(c: PoolClient, eventId: string) {
  return (await c.query(`select distinct br.supplier_id, s.name from bid_revision br join supplier_org s on s.tenant_id = br.tenant_id and s.id = br.supplier_id
                          where br.event_id = $1 order by s.name`, [eventId])).rows as { supplier_id: string; name: string }[];
}

/** Totals out of 100 per bidder: each evaluator's mean criterion score x 10, then the mean across evaluators who finished that bidder. */
async function computeTotals(c: PoolClient, eventId: string, CRITERIA: readonly string[]) {
  const rows = (await c.query(`select supplier_id, evaluator_membership_id as ev, criterion, score::float8 as score from tech_score where event_id = $1`, [eventId])).rows;
  const by = new Map<string, Map<string, Map<string, number>>>();
  for (const r of rows) {
    if (!by.has(r.supplier_id)) by.set(r.supplier_id, new Map());
    const m = by.get(r.supplier_id)!;
    if (!m.has(r.ev)) m.set(r.ev, new Map());
    m.get(r.ev)!.set(r.criterion, r.score);
  }
  const out = new Map<string, { total: number | null; evaluators: number }>();
  for (const [sid, evs] of by) {
    const finished = [...evs.values()].filter((m) => CRITERIA.every((k) => m.has(k)));
    const per = finished.map((m) => (CRITERIA.reduce((s, k) => s + m.get(k)!, 0) / CRITERIA.length) * 10);
    out.set(sid, { total: per.length ? round2(per.reduce((a, b) => a + b, 0) / per.length) : null, evaluators: per.length });
  }
  return out;
}

export async function getEvalView(pool: Pool, who: Who, eventId: string): Promise<EvalView | null> {
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state, state_version, closes_at from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev) return null;
    const cfg = await resolveConfig(c, eventId);
    const CRITERIA = cfg.criteria; const QUALIFY_AT = cfg.qualifyAt;
    const subject = await loadSubject(c, who.userId, eventId);
    const roles = [...subject.effectiveRoles] as string[];
    const isAdmin = who.role === "admin";
    const involved = isAdmin || roles.length > 0;
    const bidders = await bidderRows(c, eventId);
    const actor = internal(who);

    const witnesses = (await c.query(`select em.membership_id, u.email from event_member em join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id
                                        join app_user u on u.id = m.user_id where em.event_id = $1 and em.event_role = 'witness' order by u.email`, [eventId]))
      .rows.map((r) => ({ membershipId: r.membership_id as string, email: r.email as string }));

    // The technical text is read through the central authorization service: it returns nothing unless the envelope is open and this person may read it.
    const items = await readBidItems(c, actor, eventId);
    const tech = items.filter((i) => i.dataClass === "D6" && i.kind.startsWith("technical"));
    const visible: Bidder[] | null = tech.length
      ? tech.map((t) => ({ supplierId: t.supplierId, name: bidders.find((b) => b.supplier_id === t.supplierId)?.name ?? "", revisionNo: t.revisionNo, technicalText: String((t.payload as { text?: string }).text ?? "") }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : null;

    const mine = (await c.query(`select supplier_id, criterion, score::float8 as score from tech_score where event_id = $1 and evaluator_membership_id = $2`, [eventId, who.membershipId])).rows;
    const myScores: EvalView["myScores"] = {};
    for (const r of mine) (myScores[r.supplier_id] ??= {})[r.criterion] = r.score;

    let results: ResultRow[] | null = null;
    const canSeeScores = roles.includes("tech_approver") || roles.includes("buyer") || roles.includes("auditor") || isAdmin;
    if (ev.state === "technical_evaluation" && canSeeScores && roles.some((r) => r === "tech_approver" || r === "auditor")) {
      const totals = await computeTotals(c, eventId, CRITERIA);
      results = bidders.map((b) => { const t = totals.get(b.supplier_id); return { supplierId: b.supplier_id, name: b.name, total: t?.total ?? null, evaluators: t?.evaluators ?? 0, suggested: (t?.total ?? 0) >= QUALIFY_AT }; });
    } else if (["technical_approved", "commercial_evaluation", "recommended", "pending_award", "awarded"].includes(ev.state) && involved) {
      const tr = (await c.query(`select t.supplier_id, s.name, t.total::float8 as total, t.qualified from tech_result t join supplier_org s on s.tenant_id = t.tenant_id and s.id = t.supplier_id where t.event_id = $1 order by t.total desc`, [eventId])).rows;
      results = tr.map((r) => ({ supplierId: r.supplier_id, name: r.name, total: r.total, evaluators: 0, suggested: r.total >= QUALIFY_AT, qualified: r.qualified }));
    }
    return {
      state: ev.state, stateVersion: ev.state_version, closesAt: ev.closes_at ? new Date(ev.closes_at).toISOString() : null,
      roles, isAdmin, bidderCount: involved ? bidders.length : null, witnesses, bidders: visible, myScores, results, criteria: CRITERIA, qualifyAt: QUALIFY_AT,
    };
  });
}

async function transition(pool: Pool, who: Who, eventId: string, command: string, version: number, payload: Parameters<typeof applyTransition>[4]["payload"], after?: (c: PoolClient) => Promise<void>): Promise<EvalOut> {
  return withTenant(pool, who.tenantId, async (c) => {
    const res = await applyTransition(c, internal(who), eventId, command, { expectedVersion: version, payload });
    if (!res.ok) return { ok: false as const, error: why(res.decision.reason) };
    if (after) await after(c);
    return { ok: true as const };
  });
}

export const closeBidding = (pool: Pool, who: Who, eventId: string, version: number) => transition(pool, who, eventId, "CloseEvent", version, {});
export const openTechnicalEnvelopes = (pool: Pool, who: Who, eventId: string, version: number, witnessMembershipId: string) =>
  transition(pool, who, eventId, "OpenEnvelope1", version, { witnessMembershipId });

export async function saveScores(pool: Pool, who: Who, eventId: string, supplierId: string, scores: Record<string, number>): Promise<EvalOut> {
  const CRITERIA = (await withTenant(pool, who.tenantId, (c) => resolveConfig(c, eventId))).criteria;
  for (const k of CRITERIA) {
    const v = scores[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 10 || Math.round(v * 10) !== v * 10) return { ok: false, error: `Score "${k}" from 0 to 10 (one decimal at most).` };
  }
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state from sourcing_event where id = $1 for update`, [eventId])).rows[0];
    if (!ev) return { ok: false as const, error: "Event not found." };
    const subject = await loadSubject(c, who.userId, eventId);
    if (!subject.ownRoles.has("tech_evaluator")) return { ok: false as const, error: "Only a technical evaluator of this event can score." };
    if (ev.state !== "technical_evaluation") return { ok: false as const, error: "Scoring is open only during technical evaluation." };
    if (!(await bidderRows(c, eventId)).some((b) => b.supplier_id === supplierId)) return { ok: false as const, error: "That supplier has no bid." };
    await c.query(`delete from tech_score where event_id = $1 and supplier_id = $2 and evaluator_membership_id = $3`, [eventId, supplierId, who.membershipId]);
    for (const k of CRITERIA) await c.query(`insert into tech_score (tenant_id, event_id, supplier_id, evaluator_membership_id, criterion, score) values ($1,$2,$3,$4,$5,$6)`, [who.tenantId, eventId, supplierId, who.membershipId, k, scores[k]]);
    await audit(c, internal(who), eventId, "tech.scored", { supplierId });
    return { ok: true as const };
  });
}

export async function approveTechnical(pool: Pool, who: Who, eventId: string, version: number, qualifiedSupplierIds: string[]): Promise<EvalOut> {
  return withTenant(pool, who.tenantId, async (c) => {
    const CRITERIA = (await resolveConfig(c, eventId)).criteria;
    const bidders = await bidderRows(c, eventId);
    const evaluators = (await c.query(`select em.membership_id, u.email from event_member em join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id join app_user u on u.id = m.user_id
                                         where em.event_id = $1 and em.event_role = 'tech_evaluator'`, [eventId])).rows;
    if (!evaluators.length) return { ok: false as const, error: "No technical evaluator is assigned to this event." };
    const have = (await c.query(`select supplier_id, evaluator_membership_id as ev, count(distinct criterion)::int as n from tech_score where event_id = $1 group by 1, 2`, [eventId])).rows;
    for (const e of evaluators) for (const b of bidders) {
      if (!have.some((h) => h.ev === e.membership_id && h.supplier_id === b.supplier_id && h.n >= CRITERIA.length)) return { ok: false as const, error: `${e.email} has not finished scoring ${b.name}.` };
    }
    const totals = await computeTotals(c, eventId, CRITERIA);
    const res = await applyTransition(c, internal(who), eventId, "ApproveTechnicalResult", { expectedVersion: version, payload: { qualifiedSupplierIds, idempotencyKey: `technical:${eventId}:${version}` } });
    if (!res.ok) return { ok: false as const, error: why(res.decision.reason) };
    for (const b of bidders) {
      await c.query(`insert into tech_result (tenant_id, event_id, supplier_id, total, qualified) values ($1,$2,$3,$4,$5)`,
        [who.tenantId, eventId, b.supplier_id, totals.get(b.supplier_id)?.total ?? 0, qualifiedSupplierIds.includes(b.supplier_id)]);
    }
    return { ok: true as const };
  });
}
