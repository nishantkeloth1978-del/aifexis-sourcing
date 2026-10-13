import type { Pool, PoolClient } from "pg";
import { audit, checkTransition, loadEvent, withTenant, type Actor, type TransitionPayload } from "@/authz";
import { TWO_PERSON, payloadHash } from "@/authz/confirm";
import type { Who } from "@/events/service";

const internal = (who: Who): Actor => ({ kind: "internal", userId: who.userId, tenantId: who.tenantId });

export type DecisionOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const COMMAND_LABEL: Record<string, string> = {
  OpenEnvelope1: "Open the technical envelopes",
  OpenEnvelope2: "Open the commercial envelopes",
  CancelEvent: "Cancel the event",
  StartFinalRound: "Start a final round",
  ReopenForAmendment: "Reopen the event for an amendment",
};
const NO_LONGER: Record<string, string> = { witness: "You are no longer the witness of this event.", award_approver: "You are no longer the award approver of this event." };

const REASON: Record<string, string> = {
  BAD_STATE: "This cannot be done in the event's current state.",
  STALE_VERSION: "The event changed while you were looking. Reload and try again.",
  FORBIDDEN_ROLE: "You are not allowed to do this on this event.",
  SOD_VIOLATION: "You cannot be your own witness or approver.",
  WITNESS_REQUIRED: "Choose a witness assigned to this event.",
  APPROVAL_REQUIRED: "Choose an award approver of this event.",
  NOT_FOUND: "Event not found.",
};

/**
 * The person starting a sensitive step asks a named witness or approver to confirm it.
 * Nothing happens yet: the other person must sign in, see the request and confirm it themselves.
 */
export async function requestDecision(pool: Pool, who: Who, eventId: string, version: number, command: string, payload: TransitionPayload): Promise<DecisionOut<{ requestId: string }>> {
  const spec = TWO_PERSON[command];
  if (!spec) return { ok: false, error: "That step does not need a second person." };
  if (command === "CancelEvent" && (payload.cancelReason ?? "").trim().length < 10) return { ok: false, error: "Say why the event is cancelled (at least 10 characters)." };
  if (command === "StartFinalRound" && (!payload.finalRound || payload.finalRound.reason.trim().length < 5 || !payload.finalRound.shortlist.length || Number.isNaN(new Date(payload.finalRound.closesAt).getTime()))) return { ok: false, error: "Choose at least one bidder, a closing time and a reason (at least 5 characters)." };
  return withTenant(pool, who.tenantId, async (c) => {
    const d = await checkTransition(c, internal(who), eventId, command, version, payload, { forRequest: true });
    if (!d.allow) return { ok: false as const, error: REASON[d.reason] ?? "That is not allowed." };
    const second = payload[spec.field]!;
    await c.query(`update decision_request set status = 'cancelled' where event_id = $1 and command = $2 and requested_by = $3 and status in ('pending', 'confirmed')`, [eventId, command, who.membershipId]);
    const ins = await c.query(
      `insert into decision_request (tenant_id, event_id, command, state_version, payload, payload_hash, requested_by, designated)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8) returning id`,
      [who.tenantId, eventId, command, version, JSON.stringify(payload), payloadHash(command, payload), who.membershipId, second]);
    await audit(c, internal(who), eventId, "decision.requested", { command, requestId: ins.rows[0].id, designated: second });
    return { ok: true as const, requestId: ins.rows[0].id as string };
  });
}

export interface DecisionRow {
  id: string; eventId: string; eventRef: string; eventTitle: string; command: string; label: string; detail: string | null;
  requestedBy: string; designatedId: string; designatedEmail: string; status: string; stale: boolean; expiresAt: string; createdAt: string;
}

const SELECT = `select d.id, d.event_id, d.designated, e.ref, e.title, d.command, d.payload, d.status, d.expires_at, d.created_at, d.state_version, e.state_version as current_version,
                       ru.email as requested_by, du.email as designated_email
                  from decision_request d
                  join sourcing_event e on e.tenant_id = d.tenant_id and e.id = d.event_id
                  join membership rm on rm.tenant_id = d.tenant_id and rm.id = d.requested_by join app_user ru on ru.id = rm.user_id
                  join membership dm on dm.tenant_id = d.tenant_id and dm.id = d.designated join app_user du on du.id = dm.user_id`;

function shape(r: Record<string, any>): DecisionRow {
  const p = r.payload ?? {};
  const detail: string | null = r.command === "CancelEvent" ? p.cancelReason ?? null : r.command === "StartFinalRound" ? p.finalRound?.reason ?? null : null;
  const expired = new Date(r.expires_at).getTime() <= Date.now();
  const status = r.status === "pending" && expired ? "expired" : r.status;
  return {
    id: r.id, eventId: r.event_id, eventRef: r.ref ?? "", eventTitle: r.title, command: r.command, label: COMMAND_LABEL[r.command] ?? r.command, detail,
    requestedBy: r.requested_by, designatedId: r.designated, designatedEmail: r.designated_email, status, stale: r.state_version !== r.current_version,
    expiresAt: new Date(r.expires_at).toISOString(), createdAt: new Date(r.created_at).toISOString(),
  };
}

/** What other people have asked this person to confirm. */
export async function inbox(pool: Pool, who: Who): Promise<DecisionRow[]> {
  return withTenant(pool, who.tenantId, async (c) =>
    (await c.query(`${SELECT} where d.designated = $1 and d.status = 'pending' and d.expires_at > now() order by d.created_at`, [who.membershipId])).rows.map(shape));
}

export async function pendingCount(pool: Pool, who: Who): Promise<number> {
  return withTenant(pool, who.tenantId, async (c) => (await c.query(`select count(*)::int n from decision_request where designated = $1 and status = 'pending' and expires_at > now()`, [who.membershipId])).rows[0].n as number);
}

/** The state of this person's own request for one step on one event, for the screen that started it. */
export async function requestIn(c: PoolClient, who: Who, eventId: string, command: string): Promise<DecisionRow | null> {
  const r = (await c.query(`${SELECT} where d.event_id = $1 and d.command = $2 and d.requested_by = $3 order by d.created_at desc limit 1`, [eventId, command, who.membershipId])).rows[0];
  if (!r) return null;
  const row = shape(r);
  return row.status === "executed" ? null : row;
}
export const myRequest = (pool: Pool, who: Who, eventId: string, command: string) => withTenant(pool, who.tenantId, (c) => requestIn(c, who, eventId, command));

/** The designated person confirms or declines. Only they can, only while the event is exactly as it was when they were asked. */
export async function decide(pool: Pool, who: Who, requestId: string, approve: boolean): Promise<DecisionOut> {
  return withTenant(pool, who.tenantId, async (c) => {
    const r = (await c.query(`select * from decision_request where id = $1 for update`, [requestId])).rows[0];
    if (!r || r.designated !== who.membershipId) return { ok: false as const, error: "This request is not addressed to you." };
    if (r.requested_by === who.membershipId) return { ok: false as const, error: "You cannot confirm your own request." };
    if (r.status !== "pending") return { ok: false as const, error: "This request has already been answered or withdrawn." };
    if (new Date(r.expires_at).getTime() <= Date.now()) return { ok: false as const, error: "This request has expired. Ask for a new one." };
    const ev = await loadEvent(c, r.event_id);
    if (!ev || ev.stateVersion !== r.state_version) return { ok: false as const, error: "The event has changed since you were asked. Ask for a new request." };
    const spec = TWO_PERSON[r.command]!;
    const holds = (await c.query(`select 1 from event_member where event_id = $1 and membership_id = $2 and event_role = $3`, [r.event_id, who.membershipId, spec.role])).rowCount! > 0;
    if (!holds) return { ok: false as const, error: NO_LONGER[spec.role]! };
    await c.query(`update decision_request set status = $2, decided_by = $3, decided_at = now() where tenant_id = $1 and id = $4`, [who.tenantId, approve ? "confirmed" : "rejected", who.membershipId, requestId]);
    await audit(c, internal(who), r.event_id, approve ? "decision.confirmed" : "decision.declined", { command: r.command, requestId });
    return { ok: true as const };
  });
}

/** The requester withdraws a request that is still open. */
export async function withdraw(pool: Pool, who: Who, requestId: string): Promise<DecisionOut> {
  return withTenant(pool, who.tenantId, async (c) => {
    const r = await c.query(`update decision_request set status = 'cancelled' where id = $1 and requested_by = $2 and status in ('pending', 'confirmed') returning event_id`, [requestId, who.membershipId]);
    if (!r.rowCount) return { ok: false as const, error: "Nothing to withdraw." };
    await audit(c, internal(who), r.rows[0].event_id, "decision.withdrawn", { requestId });
    return { ok: true as const };
  });
}
