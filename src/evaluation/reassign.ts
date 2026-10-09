import type { Pool } from "pg";
import { audit, loadSubject, withTenant, type Actor } from "@/authz";
import type { Who } from "@/events/service";
import { notify } from "@/notifications/hooks";

export type RaOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface ReassignInfo {
  canReassign: boolean;
  evaluators: { membershipId: string; email: string; scored: number }[];
  candidates: { membershipId: string; email: string }[];
  history: { at: string; from: string; to: string; reason: string }[];
}
const internal = (w: Who): Actor => ({ kind: "internal", userId: w.userId, tenantId: w.tenantId });

export async function getReassignInfo(pool: Pool, who: Who, eventId: string): Promise<ReassignInfo | null> {
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev) return null;
    const s = await loadSubject(c, who.userId, eventId);
    const may = (s.ownRoles.has("buyer") || who.role === "admin") && ["published", "closed", "technical_evaluation"].includes(ev.state);
    const history = (await c.query(`select r.at, f.email as f, t.email as t, r.reason from evaluator_reassignment r
        join membership mf on mf.tenant_id = r.tenant_id and mf.id = r.from_membership join app_user f on f.id = mf.user_id
        join membership mt on mt.tenant_id = r.tenant_id and mt.id = r.to_membership join app_user t on t.id = mt.user_id
       where r.event_id = $1 order by r.at`, [eventId])).rows.map((r) => ({ at: new Date(r.at).toISOString(), from: r.f as string, to: r.t as string, reason: r.reason as string }));
    if (!may && !history.length) return { canReassign: false, evaluators: [], candidates: [], history };
    const evaluators = may ? (await c.query(`select em.membership_id, u.email, (select count(*)::int from tech_score ts where ts.event_id = em.event_id and ts.evaluator_membership_id = em.membership_id) as scored
        from event_member em join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id join app_user u on u.id = m.user_id
       where em.event_id = $1 and em.event_role = 'tech_evaluator' order by u.email`, [eventId])).rows.map((r) => ({ membershipId: r.membership_id as string, email: r.email as string, scored: r.scored as number })) : [];
    const candidates = may ? (await c.query(`select m.id as membership_id, u.email from membership m join app_user u on u.id = m.user_id
        where m.role in ('admin', 'member') and not exists (select 1 from event_member em where em.event_id = $1 and em.membership_id = m.id) order by u.email`, [eventId])).rows
      .map((r) => ({ membershipId: r.membership_id as string, email: r.email as string })) : [];
    return { canReassign: may, evaluators, candidates, history };
  });
}

/**
 * Replaces one technical evaluator with another while bids are being evaluated. The departing evaluator's scores stay on record
 * but no longer count; the new evaluator starts from a blank sheet and must declare any conflict of interest.
 */
export async function reassignEvaluator(pool: Pool, who: Who, eventId: string, fromId: string, toId: string, reason: string): Promise<RaOut> {
  const why = String(reason ?? "").trim();
  if (why.length < 5) return { ok: false, error: "Say why the evaluator is being replaced (at least 5 characters)." };
  if (fromId === toId) return { ok: false, error: "Choose a different person." };
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state from sourcing_event where id = $1 for update`, [eventId])).rows[0];
    if (!ev) return { ok: false as const, error: "Event not found." };
    const s = await loadSubject(c, who.userId, eventId);
    if (!(s.ownRoles.has("buyer") || who.role === "admin")) return { ok: false as const, error: "Only the buyer or an administrator can replace an evaluator." };
    if (!["published", "closed", "technical_evaluation"].includes(ev.state)) return { ok: false as const, error: "An evaluator can be replaced until the technical result is approved." };
    if (!(await c.query(`select 1 from event_member where event_id = $1 and membership_id = $2 and event_role = 'tech_evaluator'`, [eventId, fromId])).rowCount) return { ok: false as const, error: "That person is not a technical evaluator on this event." };
    if (!(await c.query(`select 1 from membership where id = $1 and role in ('admin', 'member')`, [toId])).rowCount) return { ok: false as const, error: "That person is not a member of this organisation." };
    try {
      await c.query("savepoint ra");
      const r = await c.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'tech_evaluator') on conflict do nothing`, [who.tenantId, eventId, toId]);
      if (!r.rowCount) { await c.query("release savepoint ra"); return { ok: false as const, error: "That person already evaluates this event." }; }
      await c.query("release savepoint ra");
    } catch (e) {
      await c.query("rollback to savepoint ra");
      if (/separation of duties/i.test((e as Error).message)) return { ok: false as const, error: "That person has a role on this event that conflicts with evaluating it (separation of duties)." };
      throw e;
    }
    await c.query(`delete from event_member where event_id = $1 and membership_id = $2 and event_role = 'tech_evaluator'`, [eventId, fromId]);
    await c.query(`insert into evaluator_reassignment (tenant_id, event_id, from_membership, to_membership, reason, by_membership) values ($1,$2,$3,$4,$5,$6)`, [who.tenantId, eventId, fromId, toId, why, who.membershipId]);
    await audit(c, internal(who), eventId, "evaluator.reassigned", { from: fromId, to: toId });
    const u = (await c.query(`select user_id from membership where id = $1`, [toId])).rows[0]?.user_id as string | undefined;
    const ref = (await c.query(`select ref from sourcing_event where id = $1`, [eventId])).rows[0]?.ref ?? "an event";
    await notify(c, who.tenantId, [u], eventId, "assigned", `You were assigned as a technical evaluator on ${ref}.`);
    return { ok: true as const };
  });
}
