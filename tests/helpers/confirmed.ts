/**
 * Since R1-3 the witness or approver must confirm for themselves. These wrappers do what two people do on screen:
 * the requester asks, the named person confirms, then the requester runs the step. If the request itself is refused, that refusal is returned.
 */
import type { Pool } from "pg";
import { withTenant } from "@/authz";
import type { Who } from "@/events/service";
import { decide, requestDecision } from "@/decisions/service";
import { openTechnicalEnvelopes } from "@/evaluation/service";
import { openCommercialEnvelopes } from "@/commercial/service";
import { cancelEvent } from "@/events/cancel";
import { startFinalRound } from "@/events/rounds";
import type { TransitionPayload } from "@/authz";

export async function whoIs(pool: Pool, base: Who, membershipId: string): Promise<Who> {
  const r = await withTenant(pool, base.tenantId, (c) => c.query(`select user_id from membership where id = $1`, [membershipId]));
  return { ...base, userId: r.rows[0]?.user_id ?? base.userId, membershipId };
}

type Out = { ok: true } | { ok: false; error: string };
export async function confirmFirst(pool: Pool, who: Who, eventId: string, version: number, command: string, payload: TransitionPayload, secondId: string): Promise<Out> {
  const req = await requestDecision(pool, who, eventId, version, command, payload);
  if (!req.ok) return req;
  const second = await whoIs(pool, who, secondId);
  const d = await decide(pool, second, req.requestId, true);
  return d.ok ? { ok: true } : d;
}

export async function openTechnicalConfirmed(pool: Pool, who: Who, eventId: string, version: number, witnessId: string) {
  const c = await confirmFirst(pool, who, eventId, version, "OpenEnvelope1", { witnessMembershipId: witnessId }, witnessId);
  return c.ok ? openTechnicalEnvelopes(pool, who, eventId, version, witnessId) : c;
}
export async function openCommercialConfirmed(pool: Pool, who: Who, eventId: string, version: number, witnessId: string) {
  const c = await confirmFirst(pool, who, eventId, version, "OpenEnvelope2", { witnessMembershipId: witnessId }, witnessId);
  return c.ok ? openCommercialEnvelopes(pool, who, eventId, version, witnessId) : c;
}
export async function cancelConfirmed(pool: Pool, who: Who, eventId: string, version: number, input: { reason: string; approverId: string }) {
  const c = await confirmFirst(pool, who, eventId, version, "CancelEvent", { approvedByMembershipId: input.approverId, cancelReason: input.reason.trim() }, input.approverId);
  return c.ok ? cancelEvent(pool, who, eventId, version, input) : c;
}
export async function finalRoundConfirmed(pool: Pool, who: Who, eventId: string, version: number, input: { shortlist: string[]; closesAt: string; reason: string; approverId: string }) {
  const c = await confirmFirst(pool, who, eventId, version, "StartFinalRound", { approvedByMembershipId: input.approverId, finalRound: { shortlist: input.shortlist, closesAt: input.closesAt, reason: input.reason.trim() } }, input.approverId);
  return c.ok ? startFinalRound(pool, who, eventId, version, input) : c;
}

/** For tests that call applyTransition directly: records an already-confirmed request for the event as it is now. */
export async function seedConfirmation(admin: import("pg").Client, tenantId: string, eventId: string, command: string, requestedBy: string, payload: TransitionPayload, secondId: string): Promise<void> {
  const { payloadHash } = await import("@/authz/confirm");
  const v = (await admin.query(`select state_version from sourcing_event where id = $1`, [eventId])).rows[0].state_version;
  await admin.query(`update decision_request set status = 'cancelled' where event_id = $1 and command = $2 and requested_by = $3 and status in ('pending','confirmed')`, [eventId, command, requestedBy]);
  await admin.query(
    `insert into decision_request (tenant_id, event_id, command, state_version, payload, payload_hash, requested_by, designated, status, decided_by, decided_at)
     values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,'confirmed',$8,now())`,
    [tenantId, eventId, command, v, JSON.stringify(payload), payloadHash(command, payload), requestedBy, secondId]);
}
