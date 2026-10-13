import type { PoolClient } from "pg";
import type { Who } from "@/events/service";
import { can } from "./permissions";

/** Event roles that may see the internal target prices of an event. Technical evaluators and witnesses do not need them. */
export const TARGET_PRICE_ROLES = ["buyer", "requester", "comm_evaluator", "publication_approver", "award_approver", "auditor"] as const;
/** Event roles that may change a draft. */
export const DRAFT_EDIT_ROLES = ["buyer", "requester"] as const;

export interface EventAccess { exists: boolean; creator: boolean; roles: ReadonlySet<string> }

/** Who this person is on one event: its creator and the event roles they hold. */
export async function eventAccess(c: PoolClient, who: Who, eventId: string): Promise<EventAccess> {
  const e = (await c.query(`select created_by from sourcing_event where id = $1`, [eventId])).rows[0];
  if (!e) return { exists: false, creator: false, roles: new Set() };
  const roles = new Set((await c.query(`select event_role from event_member where event_id = $1 and membership_id = $2`, [eventId, who.membershipId])).rows.map((r) => r.event_role as string));
  return { exists: true, creator: e.created_by === who.membershipId, roles };
}

export const mayReadEvent = (who: Who, a: EventAccess) => a.exists && (can(who, "event.read_all") || a.creator || a.roles.size > 0);
export const mayEditDraft = (who: Who, a: EventAccess) => a.exists && (can(who, "event.edit_any_draft") || (can(who, "event.create") && (a.creator || DRAFT_EDIT_ROLES.some((r) => a.roles.has(r)))));
export const mayReadTargetPrice = (who: Who, a: EventAccess) => a.exists && (can(who, "event.read_all") || a.creator || TARGET_PRICE_ROLES.some((r) => a.roles.has(r)));

/** The sentence a screen shows when a person may not change a draft. */
export const NOT_YOUR_DRAFT = "This draft belongs to someone else. Ask the person who created it, or an administrator.";
