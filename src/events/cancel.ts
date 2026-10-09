import type { Pool } from "pg";
import { applyTransition, withTenant, type Actor } from "@/authz";
import type { Who } from "./service";

export type CancelOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface CancelInfo { canCancel: boolean; approvers: { membershipId: string; email: string }[]; cancelledAt: string | null; reason: string | null }
const internal = (who: Who): Actor => ({ kind: "internal", userId: who.userId, tenantId: who.tenantId });
const REASON: Record<string, string> = {
  BAD_STATE: "This event can no longer be cancelled.",
  STALE_VERSION: "The event changed while you were looking. Reload and try again.",
  FORBIDDEN_ROLE: "Only the buyer can cancel an event.",
  APPROVAL_REQUIRED: "Choose an award approver of this event to agree to the cancellation.",
  REASON_REQUIRED: "Say why the event is cancelled (at least 10 characters).",
  NOT_FOUND: "Event not found.",
};
const CANCELLABLE = ["pending_publication", "published", "closed", "technical_evaluation", "technical_approved", "commercial_evaluation", "recommended", "pending_award"];

export async function getCancelInfo(pool: Pool, who: Who, eventId: string): Promise<CancelInfo | null> {
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state, cancel_reason, cancelled_at from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev) return null;
    const isBuyer = (await c.query(`select 1 from event_member where event_id = $1 and membership_id = $2 and event_role = 'buyer'`, [eventId, who.membershipId])).rowCount! > 0;
    const canCancel = isBuyer && CANCELLABLE.includes(ev.state);
    const approvers = canCancel ? (await c.query(`select em.membership_id, u.email from event_member em join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id join app_user u on u.id = m.user_id where em.event_id = $1 and em.event_role = 'award_approver' order by u.email`, [eventId])).rows
      .map((r) => ({ membershipId: r.membership_id as string, email: r.email as string })) : [];
    return { canCancel, approvers, cancelledAt: ev.cancelled_at ? new Date(ev.cancelled_at).toISOString() : null, reason: ev.cancel_reason ?? null };
  });
}

/** Cancels a submitted event. The buyer gives a reason and names an award approver who agrees; bids and evaluation stay on record. */
export async function cancelEvent(pool: Pool, who: Who, eventId: string, expectedVersion: number, input: { reason: string; approverId: string }): Promise<CancelOut> {
  const reason = (input.reason ?? "").trim();
  if (reason.length < 10) return { ok: false, error: REASON.REASON_REQUIRED! };
  return withTenant(pool, who.tenantId, async (c) => {
    const r = await applyTransition(c, internal(who), eventId, "CancelEvent", { expectedVersion, payload: { approvedByMembershipId: input.approverId, cancelReason: reason } });
    if (!r.ok) return { ok: false as const, error: REASON[r.decision.reason] ?? "That is not allowed." };
    return { ok: true as const };
  });
}

/** What a supplier is told about a cancelled event. */
export async function cancellationNote(pool: Pool, tenantId: string, eventId: string): Promise<{ reason: string; at: string } | null> {
  return withTenant(pool, tenantId, async (c) => {
    const r = (await c.query(`select cancel_reason, cancelled_at from sourcing_event where id = $1 and state = 'cancelled'`, [eventId])).rows[0];
    return r ? { reason: r.cancel_reason as string, at: new Date(r.cancelled_at).toISOString() } : null;
  });
}
