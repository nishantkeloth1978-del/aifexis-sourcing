import type { Pool, PoolClient } from "pg";
import { applyTransition, audit, resolveOpening, withTenant, type Actor } from "@/authz";
import type { Who } from "@/events/service";

/**
 * Automatic opening: when the company chose "automatic", the system opens the envelopes by itself the moment bidding closes
 * (both envelopes at once for one-envelope events) and again when the technical result is approved. Autopilot events keep their own flow.
 * A refusal (no bids yet, for example) leaves the event where it is, for a person to handle.
 */
export async function autoOpenIfConfigured(c: PoolClient, tenantId: string, eventId: string): Promise<boolean> {
  const ev = (await c.query(`select state::text as state, state_version, autopilot from sourcing_event where id = $1`, [eventId])).rows[0];
  if (!ev || ev.autopilot) return false;
  const { mode, envelopes } = await resolveOpening(c, eventId);
  if (mode !== "automatic") return false;
  const command = ev.state === "closed" ? (envelopes === "single" ? "OpenEnvelopesTogether" : "OpenEnvelope1") : ev.state === "technical_approved" ? "OpenEnvelope2" : null;
  if (!command) return false;
  const system: Actor = { kind: "system", tenantId };
  await c.query("savepoint auto_open");
  try {
    const r = await applyTransition(c, system, eventId, command, { expectedVersion: ev.state_version });
    if (!r.ok) { await c.query("rollback to savepoint auto_open"); return false; }
    await c.query("release savepoint auto_open");
    await audit(c, system, eventId, "opening.automatic", { command, text: "Envelopes opened automatically, as the company's opening setting says." });
    return true;
  } catch { await c.query("rollback to savepoint auto_open").catch(() => undefined); return false; }
}

/** Opens technical and price envelopes together on a one-envelope event. The witness is needed only when the mode is witnessed. */
export async function openAllEnvelopes(pool: Pool, who: Who, eventId: string, version: number, witnessMembershipId?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return withTenant(pool, who.tenantId, async (c) => {
    const res = await applyTransition(c, { kind: "internal", userId: who.userId, tenantId: who.tenantId }, eventId, "OpenEnvelopesTogether", { expectedVersion: version, payload: witnessMembershipId ? { witnessMembershipId } : {} });
    return res.ok ? { ok: true as const } : { ok: false as const, error: REASON[res.decision.reason] ?? "That is not allowed." };
  });
}

export const REASON: Record<string, string> = {
  BAD_STATE: "The event is not in the right state for that.", STALE_VERSION: "The event changed while you were looking. Reload and try again.",
  FORBIDDEN_ROLE: "You do not have the required role on this event.", WITNESS_REQUIRED: "Choose a witness assigned to this event.",
  CONFIRMATION_REQUIRED: "The witness has not confirmed this request yet.", SOD_VIOLATION: "You cannot be your own witness.",
  WRONG_FLOW: "This event opens its envelopes a different way. Reload the page.", NO_BIDS: "No bids were received.",
  NO_QUALIFIED_BIDS: "Every bidder failed a mandatory declaration, so there is nobody to compare.", NOT_FOUND: "Event not found.",
};
