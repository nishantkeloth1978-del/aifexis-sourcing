import type { Pool } from "pg";
import { loadSubject, withTenant } from "@/authz";
import { getCommercialView, type Comparison } from "@/commercial/service";
import type { Who } from "@/events/service";

export interface AwardPack {
  event: { ref: string; title: string; ownerDept: string; currency: string; state: string; closesAt: string | null; envelope1: string | null; envelope2: string | null; createdAt: string };
  team: { email: string; role: string }[];
  openings: { envelope: number; openedBy: string; witness: string; at: string }[];
  criteria: { names: string[]; weights: { technical: number; commercial: number }; qualifyAt: number } | null;
  technical: { name: string; total: number; qualified: boolean }[];
  comparison: Comparison | null;
  recommendation: { name: string; note: string } | null;
  approvals: { email: string; decision: string; at: string }[];
  trail: { at: string; actor: string; action: string }[];
  generatedAt: string;
}

/** The record of an award for audit: who did what, when, and on what basis. Only the buyer, award approvers and auditors may open it. */
export async function getAwardPack(pool: Pool, who: Who, eventId: string): Promise<AwardPack | null> {
  const view = await getCommercialView(pool, who, eventId);
  if (!view || !["recommended", "pending_award", "awarded"].includes(view.state)) return null;
  if (!view.roles.some((r) => ["buyer", "auditor", "award_approver"].includes(r))) return null;
  return withTenant(pool, who.tenantId, async (c) => {
    const subject = await loadSubject(c, who.userId, eventId);
    const e = (await c.query(`select ref, title, coalesce(owner_dept,'') as owner_dept, coalesce(currency,'') as currency, state::text as state, closes_at, envelope1_opened_at, envelope2_opened_at, created_at, config_snapshot from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!e) return null;
    const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
    const emailOf = `(select u.email from membership m join app_user u on u.id = m.user_id where m.id = `;
    const team = (await c.query(`select u.email, em.event_role from event_member em join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id join app_user u on u.id = m.user_id where em.event_id = $1 order by em.event_role, u.email`, [eventId])).rows.map((r) => ({ email: r.email, role: r.event_role }));
    const openings = (await c.query(`select envelope, ${emailOf}opened_by) as by, ${emailOf}witness) as wit, opened_at from opening_record where event_id = $1 order by opened_at`, [eventId])).rows.map((r) => ({ envelope: r.envelope, openedBy: r.by ?? "", witness: r.wit ?? "", at: iso(r.opened_at)! }));
    const tech = subject.effectiveRoles.size ? (await c.query(`select s.name, t.total::float8 as total, t.qualified from tech_result t join supplier_org s on s.tenant_id = t.tenant_id and s.id = t.supplier_id where t.event_id = $1 order by t.total desc`, [eventId])).rows : [];
    const rec = (await c.query(`select s.name, r.note from recommendation r join supplier_org s on s.tenant_id = r.tenant_id and s.id = r.supplier_id where r.event_id = $1 order by r.created_at desc limit 1`, [eventId])).rows[0];
    const approvals = (await c.query(`select ${emailOf}approver_membership_id) as email, decision, created_at from approval where event_id = $1 and step = 'award' order by created_at`, [eventId])).rows.map((r) => ({ email: r.email ?? "", decision: r.decision, at: iso(r.created_at)! }));
    const trail = (await c.query(`select at, actor, action from audit_event where event_id = $1 and action not like 'denied:%' order by id limit 300`, [eventId])).rows.map((r) => ({ at: iso(r.at)!, actor: r.actor ?? "", action: r.action }));
    const ev = e.config_snapshot?.evaluation;
    return {
      event: { ref: e.ref, title: e.title, ownerDept: e.owner_dept, currency: e.currency, state: e.state, closesAt: iso(e.closes_at), envelope1: iso(e.envelope1_opened_at), envelope2: iso(e.envelope2_opened_at), createdAt: iso(e.created_at)! },
      team, openings,
      criteria: ev ? { names: ev.criteria, weights: ev.weights, qualifyAt: ev.qualifyAt } : null,
      technical: tech.map((t) => ({ name: t.name, total: t.total, qualified: t.qualified })),
      comparison: view.comparison, recommendation: rec ? { name: rec.name, note: rec.note } : null, approvals, trail, generatedAt: new Date().toISOString(),
    };
  });
}
