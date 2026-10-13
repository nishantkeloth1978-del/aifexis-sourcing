import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { TransitionPayload } from "./service";

/** Commands that need a second person who confirms for themselves. The field holds who that person is. */
export const TWO_PERSON: Record<string, { field: "witnessMembershipId" | "approvedByMembershipId"; role: "witness" | "award_approver" }> = {
  OpenEnvelope1: { field: "witnessMembershipId", role: "witness" },
  OpenEnvelope2: { field: "witnessMembershipId", role: "witness" },
  CancelEvent: { field: "approvedByMembershipId", role: "award_approver" },
  StartFinalRound: { field: "approvedByMembershipId", role: "award_approver" },
  ReopenForAmendment: { field: "approvedByMembershipId", role: "award_approver" },
};

/** What the second person is agreeing to: the command, who they are and the content of the request. Anything else changed means a new request. */
export function payloadHash(command: string, payload: TransitionPayload): string {
  const spec = TWO_PERSON[command];
  const fr = payload.finalRound;
  const when = fr ? new Date(fr.closesAt) : null;
  const finalRound = fr ? { shortlist: [...new Set(fr.shortlist)].sort(), closesAt: when && !Number.isNaN(when.getTime()) ? when.toISOString() : fr.closesAt, reason: fr.reason.trim() } : null;
  const body = { command, second: spec ? payload[spec.field] ?? null : null, cancelReason: payload.cancelReason?.trim() ?? null, finalRound };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

/** The confirmed, unused, unexpired request that matches this command exactly, if there is one. */
export async function confirmationFor(client: PoolClient, tenantId: string, userId: string, eventId: string, stateVersion: number, command: string, payload: TransitionPayload): Promise<string | null> {
  const spec = TWO_PERSON[command];
  if (!spec) return null;
  const r = await client.query(
    `select d.id from decision_request d join membership m on m.tenant_id = d.tenant_id and m.id = d.requested_by
      where d.tenant_id = $1 and d.event_id = $2 and d.command = $3 and d.state_version = $4 and d.status = 'confirmed' and d.expires_at > now()
        and m.user_id = $5 and d.designated = $6 and d.payload_hash = $7
      limit 1`,
    [tenantId, eventId, command, stateVersion, userId, payload[spec.field] ?? null, payloadHash(command, payload)]);
  return r.rows[0]?.id ?? null;
}
