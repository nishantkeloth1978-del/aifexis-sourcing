import type { Pool } from "pg";
import { applyTransition, withTenant, type Actor } from "@/authz";
import type { Who } from "./service";

export interface RoundCandidate { supplierId: string; name: string; qualified: boolean }
export interface RoundRow { roundNo: number; reason: string; closesAt: string; shortlist: string[]; startedAt: string }
export interface RoundInfo {
  roundNo: number; rounds: RoundRow[]; canStart: boolean; candidates: RoundCandidate[]; approvers: { membershipId: string; email: string }[];
}
export type RoundOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const internal = (who: Who): Actor => ({ kind: "internal", userId: who.userId, tenantId: who.tenantId });
const REASON: Record<string, string> = {
  BAD_STATE: "A final round can only start after the commercial envelopes are open.",
  STALE_VERSION: "The event changed while you were looking. Reload and try again.",
  FORBIDDEN_ROLE: "Only the buyer can start a final round.",
  APPROVAL_REQUIRED: "Choose an award approver of this event to agree to the final round.",
  INVALID_ROUND: "Choose at least one bidder who has bid, and a closing time in the future.",
  NOT_FOUND: "Event not found.",
};

/** Names and qualification only. Prices stay sealed; the buyer shortlists on the evaluation, not on a number shown here. */
export async function getRoundInfo(pool: Pool, who: Who, eventId: string): Promise<RoundInfo | null> {
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state, round_no from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev) return null;
    const isBuyer = (await c.query(`select 1 from event_member where event_id = $1 and membership_id = $2 and event_role = 'buyer'`, [eventId, who.membershipId])).rowCount! > 0;
    const rounds = (await c.query(`select round_no, reason, new_closes_at, shortlist, created_at from event_round where event_id = $1 order by round_no`, [eventId])).rows
      .map((r) => ({ roundNo: r.round_no as number, reason: r.reason as string, closesAt: new Date(r.new_closes_at).toISOString(), shortlist: r.shortlist as string[], startedAt: new Date(r.created_at).toISOString() }));
    const canStart = isBuyer && ["commercial_evaluation", "recommended"].includes(ev.state);
    const candidates = canStart ? (await c.query(
      `select s.id as supplier_id, s.name, exists (select 1 from qualified_bidder q where q.event_id = $1 and q.supplier_id = s.id and q.superseded_at is null) as qualified
         from supplier_org s where s.id in (select supplier_id from bid_revision where event_id = $1) order by s.name`, [eventId])).rows
      .map((r) => ({ supplierId: r.supplier_id as string, name: r.name as string, qualified: r.qualified as boolean })) : [];
    const approvers = canStart ? (await c.query(`select em.membership_id, u.email from event_member em join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id join app_user u on u.id = m.user_id where em.event_id = $1 and em.event_role = 'award_approver' order by u.email`, [eventId])).rows
      .map((r) => ({ membershipId: r.membership_id as string, email: r.email as string })) : [];
    return { roundNo: ev.round_no as number, rounds, canStart, candidates, approvers };
  });
}

export async function startFinalRound(pool: Pool, who: Who, eventId: string, expectedVersion: number,
  input: { shortlist: string[]; closesAt: string; reason: string; approverId: string }): Promise<RoundOut<{ roundNo: number }>> {
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) return { ok: false, error: "Say why a final round is needed (at least 5 characters)." };
  return withTenant(pool, who.tenantId, async (c) => {
    const r = await applyTransition(c, internal(who), eventId, "StartFinalRound", {
      expectedVersion, payload: { approvedByMembershipId: input.approverId, finalRound: { shortlist: input.shortlist, closesAt: input.closesAt, reason } } });
    if (!r.ok) return { ok: false as const, error: REASON[r.decision.reason] ?? "That is not allowed." };
    return { ok: true as const, roundNo: r.event.roundNo };
  });
}
