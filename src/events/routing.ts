import type { Pool, PoolClient } from "pg";
import { audit, withTenant } from "@/authz";
import { policyFor, resolveConfig } from "@/config/service";
import type { Who } from "./service";

export const ROUTE_STEPS = ["publication", "technical", "award"] as const;
export type RouteStep = (typeof ROUTE_STEPS)[number];
const ROLE_OF: Record<RouteStep, string> = { publication: "publication_approver", technical: "tech_approver", award: "award_approver" };

export interface Route { id: string; step: RouteStep; slot: number; ownerId: string; ownerEmail: string; deputyId: string | null; deputyEmail: string | null; awayFrom: string | null; awayTo: string | null }
export type RouteOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function listRoutes(pool: Pool, who: Who): Promise<Route[]> {
  return withTenant(pool, who.tenantId, async (c) =>
    (await c.query(`select r.id, r.step, r.slot, r.owner_membership_id, ou.email as owner_email, r.deputy_membership_id, du.email as deputy_email,
                           r.away_from::text as away_from, r.away_to::text as away_to
                      from approver_route r
                      join membership om on om.tenant_id = r.tenant_id and om.id = r.owner_membership_id join app_user ou on ou.id = om.user_id
                      left join membership dm on dm.tenant_id = r.tenant_id and dm.id = r.deputy_membership_id left join app_user du on du.id = dm.user_id
                     order by r.step, r.slot`)).rows.map((r) => ({
      id: r.id, step: r.step, slot: r.slot, ownerId: r.owner_membership_id, ownerEmail: r.owner_email,
      deputyId: r.deputy_membership_id, deputyEmail: r.deputy_email, awayFrom: r.away_from, awayTo: r.away_to })));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function saveRoute(pool: Pool, who: Who, input: { step: string; slot: number; ownerId: string; deputyId?: string | null; awayFrom?: string | null; awayTo?: string | null }): Promise<RouteOut> {
  if (who.role !== "admin") return { ok: false, error: "Only an administrator can set approver routing." };
  if (!(ROUTE_STEPS as readonly string[]).includes(input.step)) return { ok: false, error: "Unknown approval step." };
  if (!Number.isInteger(input.slot) || input.slot < 1 || input.slot > 5) return { ok: false, error: "The approver slot must be between 1 and 5." };
  const deputy = input.deputyId || null;
  if (deputy && deputy === input.ownerId) return { ok: false, error: "The deputy must be a different person from the approver." };
  const from = input.awayFrom || null, to = input.awayTo || null;
  if ((from === null) !== (to === null)) return { ok: false, error: "Enter both dates of the absence, or neither." };
  if (from && (!DATE.test(from) || !DATE.test(to!) || to! < from)) return { ok: false, error: "The absence must end on or after the day it starts." };
  if (from && !deputy) return { ok: false, error: "Name a deputy to cover an absence." };
  return withTenant(pool, who.tenantId, async (c) => {
    const ids = [input.ownerId, ...(deputy ? [deputy] : [])];
    const ok = (await c.query(`select count(*)::int n from membership where id = any($1::uuid[]) and role in ('admin', 'member')`, [ids])).rows[0].n as number;
    if (ok !== ids.length) return { ok: false as const, error: "Choose people who belong to this organisation." };
    await c.query(
      `insert into approver_route (tenant_id, step, slot, owner_membership_id, deputy_membership_id, away_from, away_to) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (tenant_id, step, slot) do update set owner_membership_id = excluded.owner_membership_id, deputy_membership_id = excluded.deputy_membership_id,
         away_from = excluded.away_from, away_to = excluded.away_to, updated_at = now()`,
      [who.tenantId, input.step, input.slot, input.ownerId, deputy, from, to]);
    return { ok: true as const };
  });
}

export async function removeRoute(pool: Pool, who: Who, id: string): Promise<RouteOut> {
  if (who.role !== "admin") return { ok: false, error: "Only an administrator can set approver routing." };
  return withTenant(pool, who.tenantId, async (c) => {
    const d = await c.query(`delete from approver_route where id = $1`, [id]);
    return d.rowCount ? { ok: true as const } : { ok: false as const, error: "That route was not found." };
  });
}

/** Who actually sits in the slot today: the deputy while the owner is away, otherwise the owner. */
export function seatFor(r: { ownerId: string; deputyId: string | null; awayFrom: string | null; awayTo: string | null }, today: string): { primary: string; fallback: string | null } {
  const away = !!(r.deputyId && r.awayFrom && r.awayTo && r.awayFrom <= today && today <= r.awayTo);
  return away ? { primary: r.deputyId!, fallback: null } : { primary: r.ownerId, fallback: r.deputyId };
}

/**
 * Fill the event team's empty approval seats from the routing table. Never removes or replaces anyone already on the team.
 * A person who conflicts with the event's separation of duties is skipped for their deputy. When an owner is seated, the
 * deputy is attached as a delegate so the deputy can act while the owner is unavailable.
 */
export async function applyRouting(c: PoolClient, who: Who, eventId: string, needs: { publication: boolean; awards: number }): Promise<{ added: string[]; missing: string[] }> {
  const added: string[] = [], missing: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const routes = (await c.query(`select step, slot, owner_membership_id, deputy_membership_id, away_from::text as away_from, away_to::text as away_to from approver_route order by step, slot`)).rows;
  for (const step of ROUTE_STEPS) {
    const need = step === "publication" ? (needs.publication ? 1 : 0) : step === "award" ? Math.max(1, needs.awards) : 0;
    const role = ROLE_OF[step];
    let have = (await c.query(`select count(*)::int n from event_member where event_id = $1 and event_role = $2`, [eventId, role])).rows[0].n as number;
    const mine = routes.filter((r) => r.step === step);
    const want = step === "technical" ? (have ? 0 : Math.min(1, mine.length)) : need;
    for (const r of mine) {
      if (have >= want) break;
      const seat = seatFor({ ownerId: r.owner_membership_id, deputyId: r.deputy_membership_id, awayFrom: r.away_from, awayTo: r.away_to }, today);
      for (const cand of [seat.primary, seat.fallback]) {
        if (!cand) continue;
        if ((await c.query(`select 1 from event_member where event_id = $1 and membership_id = $2 and event_role = $3`, [eventId, cand, role])).rowCount) { have++; break; }
        try {
          await c.query("savepoint rt");
          await c.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,$4)`, [who.tenantId, eventId, cand, role]);
          await c.query("release savepoint rt");
        } catch (e) {
          await c.query("rollback to savepoint rt");
          if (/separation of duties/i.test((e as Error).message)) continue;
          throw e;
        }
        if (cand === r.owner_membership_id && r.deputy_membership_id) {
          await c.query(`insert into delegation (tenant_id, event_id, from_membership_id, to_membership_id) values ($1,$2,$3,$4) on conflict do nothing`, [who.tenantId, eventId, cand, r.deputy_membership_id]);
        }
        added.push(`${step}`); have++; break;
      }
    }
    if (have < want) missing.push(step);
  }
  if (added.length) await audit(c, { kind: "internal", userId: who.userId, tenantId: who.tenantId }, eventId, "team.routed", { added });
  return { added, missing };
}

export async function routeEventTeam(pool: Pool, who: Who, eventId: string): Promise<RouteOut<{ added: number }>> {
  if (who.role !== "admin") return { ok: false, error: "Only an administrator can assign event roles." };
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state from sourcing_event where id = $1 for update`, [eventId])).rows[0];
    if (!ev) return { ok: false as const, error: "Event not found." };
    if (ev.state !== "draft") return { ok: false as const, error: "The team can only change while the event is a draft." };
    const v = (await c.query(`select value_aed::text as v from sourcing_event where id = $1`, [eventId])).rows[0]?.v as string | null;
    const pol = policyFor(await resolveConfig(c), v == null ? null : Number(v));
    const r = await applyRouting(c, who, eventId, { publication: !pol.autoPublish, awards: pol.awardApprovals });
    return { ok: true as const, added: r.added.length };
  });
}
