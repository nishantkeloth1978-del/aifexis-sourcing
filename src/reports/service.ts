import type { Pool } from "pg";
import { withTenant } from "@/authz";
import type { Who } from "@/events/service";

export interface BoardRow { id: string; ref: string; title: string; state: string; closesAt: string | null; bidders: number; valueAed: string | null }
export interface AwardRowR { id: string; ref: string; title: string; supplier: string; currency: string; total: string | null; estimate: string | null; saving: string | null; savingPct: number | null; awardedAt: string | null }
export interface AwardsReport { rows: AwardRowR[]; kpis: { count: number; awarded: string; estimated: string; saving: string; savingPct: number | null } }

const EVAL_STATES = ["closed", "technical_evaluation", "technical_approved", "commercial_evaluation", "recommended", "pending_award"];
const AWARDED = ["awarded", "handover_pending", "handed_over"];

/** Events that are with the evaluation team, newest first. Admins see all; others see events they are on. */
export async function evaluationBoard(pool: Pool, who: Who): Promise<BoardRow[]> {
  return withTenant(pool, who.tenantId, async (c) => (await c.query(
    `select e.id, e.ref, e.title, e.state::text as state, e.closes_at, e.value_aed::text as v,
            (select count(distinct supplier_id)::int from bid_revision b where b.event_id = e.id) as bidders
       from sourcing_event e
      where e.state::text = any($1) and ($2 or exists (select 1 from event_member em where em.event_id = e.id and em.membership_id = $3))
      order by e.closes_at desc nulls last limit 100`, [EVAL_STATES, who.role === "admin", who.membershipId])).rows
    .map((r) => ({ id: r.id, ref: r.ref, title: r.title, state: r.state, closesAt: r.closes_at ? new Date(r.closes_at).toISOString() : null, bidders: r.bidders, valueAed: r.v })));
}

const money = (n: number) => n.toFixed(2);

/** Awarded events with the winning total and, for AED events with an estimate, the saving against it. */
export async function awardsReport(pool: Pool, who: Who): Promise<AwardsReport> {
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(
      `select e.id, e.ref, e.title, coalesce(e.currency,'') as currency, e.value_aed::text as v,
              (select max(a.created_at) from approval a where a.event_id = e.id and a.step = 'award' and a.decision = 'approve') as awarded_at
         from sourcing_event e
        where e.state::text = any($1) and ($2 or exists (select 1 from event_member em where em.event_id = e.id and em.membership_id = $3))
        order by e.created_at desc limit 200`, [AWARDED, who.role === "admin", who.membershipId])).rows;
    const rows: AwardRowR[] = [];
    let sumAwarded = 0, sumEst = 0, sumSaving = 0, comparable = 0;
    for (const e of ev) {
      const rec = (await c.query(`select s.id, s.name from recommendation r join supplier_org s on s.tenant_id = r.tenant_id and s.id = r.supplier_id where r.event_id = $1 order by r.created_at desc limit 1`, [e.id])).rows[0];
      const total = rec ? (await c.query(`select bi.payload->>'total' as t from bid_item bi join bid_revision br on br.tenant_id = bi.tenant_id and br.id = bi.bid_revision_id
                                           where br.event_id = $1 and br.supplier_id = $2 and bi.kind = 'price_lines' order by br.revision_no desc limit 1`, [e.id, rec.id])).rows[0]?.t as string | undefined : undefined;
      const aed = e.currency === "" || e.currency === "AED";
      let saving: string | null = null, pct: number | null = null;
      if (total && e.v && aed && Number(e.v) > 0) {
        const s = Number(e.v) - Number(total); saving = money(s); pct = Math.round((s / Number(e.v)) * 1000) / 10;
        sumAwarded += Number(total); sumEst += Number(e.v); sumSaving += s; comparable++;
      }
      rows.push({ id: e.id, ref: e.ref, title: e.title, supplier: rec?.name ?? "-", currency: e.currency, total: total ?? null, estimate: e.v, saving, savingPct: pct, awardedAt: e.awarded_at ? new Date(e.awarded_at).toISOString() : null });
    }
    return { rows, kpis: { count: rows.length, awarded: money(sumAwarded), estimated: money(sumEst), saving: money(sumSaving), savingPct: comparable && sumEst > 0 ? Math.round((sumSaving / sumEst) * 1000) / 10 : null } };
  });
}
