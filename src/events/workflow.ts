import type { Pool } from "pg";
import { applyTransition, withTenant, type Actor } from "@/authz";
import { audit } from "@/authz";
import type { Who } from "./service";
import { clean, DEFAULT_CONFIG, policyFor, resolveConfig } from "@/config/service";
import { lotProblem } from "@/lots/service";
import { freezeTemplate, templateProblem } from "@/templates/events";

import { EVENT_ROLES, type EventRoleName } from "./roles";
export { EVENT_ROLES, ROLE_LABEL, type EventRoleName } from "./roles";

export interface TeamMember { membershipId: string; email: string; role: EventRoleName }
export interface TenantMember { membershipId: string; email: string }
export type Outcome<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const valueOf = async (c: import("pg").PoolClient, eventId: string): Promise<number | null> => {
  const v = (await c.query(`select value_aed::text as v from sourcing_event where id = $1`, [eventId])).rows[0]?.v as string | null | undefined;
  return v == null ? null : Number(v);
};

/** Once published, the frozen configuration decides how many award approvals this event's value needs. */
async function applyAwardTier(c: import("pg").PoolClient, eventId: string): Promise<void> {
  const snap = (await c.query(`select config_snapshot from sourcing_event where id = $1`, [eventId])).rows[0]?.config_snapshot;
  const cfg = clean(snap?.evaluation) ?? DEFAULT_CONFIG;
  const { awardApprovals } = policyFor(cfg, await valueOf(c, eventId));
  await c.query(`update sourcing_event set required_award_approvals = $2 where id = $1`, [eventId, awardApprovals]);
}

const internal = (who: Who): Actor => ({ kind: "internal", userId: who.userId, tenantId: who.tenantId });

const REASON: Record<string, string> = {
  BAD_STATE: "The event is not in the right state for that.",
  STALE_VERSION: "The event changed while you were looking. Reload and try again.",
  FORBIDDEN_ROLE: "You do not have the required role on this event.",
  SOD_VIOLATION: "You cannot approve an event you are working on as buyer or evaluator.",
  NOT_FOUND: "Event not found.",
};
const why = (r: string) => REASON[r] ?? "That is not allowed.";

export async function listTenantMembers(pool: Pool, who: Who): Promise<TenantMember[]> {
  return withTenant(pool, who.tenantId, async (c) =>
    (await c.query(`select m.id as membership_id, u.email from membership m join app_user u on u.id = m.user_id
                     where m.role in ('admin', 'member') order by u.email`)).rows.map((r) => ({ membershipId: r.membership_id, email: r.email })));
}

export async function listTeam(pool: Pool, who: Who, eventId: string): Promise<TeamMember[]> {
  return withTenant(pool, who.tenantId, async (c) =>
    (await c.query(`select em.membership_id, u.email, em.event_role from event_member em
                      join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id
                      join app_user u on u.id = m.user_id
                     where em.event_id = $1 order by em.event_role, u.email`, [eventId]))
      .rows.map((r) => ({ membershipId: r.membership_id, email: r.email, role: r.event_role })));
}

export async function assignRole(pool: Pool, who: Who, eventId: string, membershipId: string, role: string): Promise<Outcome> {
  if (who.role !== "admin") return { ok: false, error: "Only an administrator can assign event roles." };
  if (!(EVENT_ROLES as readonly string[]).includes(role)) return { ok: false, error: "Unknown role." };
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state from sourcing_event where id = $1 for update`, [eventId])).rows[0];
    if (!ev) return { ok: false as const, error: "Event not found." };
    if (ev.state !== "draft") return { ok: false as const, error: "The team can only change while the event is a draft." };
    const m = (await c.query(`select 1 from membership where id = $1 and role in ('admin', 'member')`, [membershipId])).rowCount;
    if (!m) return { ok: false as const, error: "That person is not a member of this organisation." };
    try {
      await c.query("savepoint a");
      const r = await c.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1, $2, $3, $4) on conflict do nothing`,
        [who.tenantId, eventId, membershipId, role]);
      if (!r.rowCount) { await c.query("release savepoint a"); return { ok: false as const, error: "That person already has this role." }; }
      await c.query("release savepoint a");
    } catch (e) {
      await c.query("rollback to savepoint a");
      if (/separation of duties/i.test((e as Error).message)) return { ok: false as const, error: "That role conflicts with another role this person already has on the event (separation of duties)." };
      throw e;
    }
    await audit(c, internal(who), eventId, "team.assigned", { membershipId, role });
    return { ok: true as const };
  });
}

export async function removeRole(pool: Pool, who: Who, eventId: string, membershipId: string, role: string): Promise<Outcome> {
  if (who.role !== "admin") return { ok: false, error: "Only an administrator can change event roles." };
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state from sourcing_event where id = $1 for update`, [eventId])).rows[0];
    if (!ev) return { ok: false as const, error: "Event not found." };
    if (ev.state !== "draft") return { ok: false as const, error: "The team can only change while the event is a draft." };
    const d = await c.query(`delete from event_member where event_id = $1 and membership_id = $2 and event_role = $3`, [eventId, membershipId, role]);
    if (!d.rowCount) return { ok: false as const, error: "That assignment was not found." };
    await audit(c, internal(who), eventId, "team.removed", { membershipId, role });
    return { ok: true as const };
  });
}

/** What can this person do with the event right now? Used to show or hide buttons; the real check happens again on the action. */
export async function myEventRoles(pool: Pool, who: Who, eventId: string): Promise<EventRoleName[]> {
  return withTenant(pool, who.tenantId, async (c) =>
    (await c.query(`select event_role from event_member where event_id = $1 and membership_id = $2`, [eventId, who.membershipId])).rows.map((r) => r.event_role));
}

/** Draft -> pending publication. Needs the buyer role, at least one item, a future closing date and an approver on the team. */
export async function submitForPublication(pool: Pool, who: Who, eventId: string, expectedVersion: number): Promise<Outcome> {
  return withTenant(pool, who.tenantId, async (c) => {
    const e = (await c.query(`select state::text as state, closes_at from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!e) return { ok: false as const, error: why("NOT_FOUND") };
    if (e.state === "draft") {
      const items = (await c.query(`select count(*)::int n from event_item where event_id = $1`, [eventId])).rows[0].n as number;
      if (!items) return { ok: false as const, error: "Add at least one item to price before submitting." };
      const lp = await lotProblem(c, eventId);
      if (lp) return { ok: false as const, error: lp };
      const tp = await templateProblem(c, eventId);
      if (tp) return { ok: false as const, error: tp };
      if (!e.closes_at || new Date(e.closes_at).getTime() <= Date.now()) return { ok: false as const, error: "Set a closing date in the future before submitting." };
      const pol = policyFor(await resolveConfig(c), await valueOf(c, eventId));
      const count = async (role: string) => (await c.query(`select count(*)::int n from event_member where event_id = $1 and event_role = $2`, [eventId, role])).rows[0].n as number;
      if (!pol.autoPublish && !(await count("publication_approver"))) return { ok: false as const, error: "Assign a publication approver to the team before submitting." };
      if (pol.awardApprovals > 1 && (await count("award_approver")) < pol.awardApprovals) return { ok: false as const, error: `An event of this value needs ${pol.awardApprovals} award ${pol.awardApprovals === 1 ? "approver" : "approvers"} on the team.` };
    }
    const r = await applyTransition(c, internal(who), eventId, "SubmitForPublication", { expectedVersion });
    if (!r.ok) return { ok: false as const, error: why(r.decision.reason) };
    await freezeTemplate(c, eventId);
    const pol = policyFor(await resolveConfig(c), await valueOf(c, eventId));
    if (pol.autoPublish) {
      const a = await applyTransition(c, { kind: "system", tenantId: who.tenantId }, eventId, "ApprovePublication", { expectedVersion: expectedVersion + 1, payload: { policyApproved: true } });
      if (!a.ok) return { ok: false as const, error: why(a.decision.reason) };
      await audit(c, internal(who), eventId, "publication.auto_approved", { reason: "below the publication approval threshold" });
      await applyAwardTier(c, eventId);
    }
    return { ok: true as const };
  });
}

/** Pending publication -> published. The approver must not be the buyer or an evaluator of this event. */
export async function approvePublication(pool: Pool, who: Who, eventId: string, expectedVersion: number): Promise<Outcome> {
  return withTenant(pool, who.tenantId, async (c) => {
    const r = await applyTransition(c, internal(who), eventId, "ApprovePublication", { expectedVersion });
    if (!r.ok) return { ok: false as const, error: why(r.decision.reason) };
    await applyAwardTier(c, eventId);
    return { ok: true as const };
  });
}
