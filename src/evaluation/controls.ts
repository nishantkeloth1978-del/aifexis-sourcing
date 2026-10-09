import type { Pool, PoolClient } from "pg";
import { audit, loadSubject, withTenant, type Actor } from "@/authz";
import { resolveConfig, type EvalConfig } from "@/config/service";
import type { Who } from "@/events/service";

export const DEFAULT_GAP = 20;
export type CtlOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const internal = (w: Who): Actor => ({ kind: "internal", userId: w.userId, tenantId: w.tenantId });
export const gapOf = (cfg: EvalConfig) => cfg.moderationGap ?? DEFAULT_GAP;
export const MIN_REASON = 5;

export interface GapRow { supplierId: string; supplierName: string; criterion: string; min: number; max: number; gap: number; reason: string | null }
export interface PendingChange { id: string; supplierName: string; criterion: string; oldScore: number; newScore: number; reason: string; evaluator: string; mine: boolean }

/** Criteria where finished evaluators differ by more than the configured gap (points out of 100). Empty when the gap is 0. */
export async function moderationGaps(c: PoolClient, eventId: string, cfg: EvalConfig): Promise<GapRow[]> {
  const gap = gapOf(cfg);
  if (gap <= 0) return [];
  const rows = (await c.query(`select supplier_id, evaluator_membership_id as ev, criterion, score::float8 as score from tech_score where event_id = $1 and evaluator_membership_id in (select membership_id from event_member where event_id = $1 and event_role = 'tech_evaluator')`, [eventId])).rows;
  const names = new Map((await c.query(`select id, name from supplier_org`)).rows.map((r) => [r.id as string, r.name as string]));
  const notes = new Map((await c.query(`select supplier_id, criterion, reason from score_moderation where event_id = $1`, [eventId])).rows.map((r) => [`${r.supplier_id}|${r.criterion}`, r.reason as string]));
  const by = new Map<string, Map<string, Map<string, number>>>();   // supplier -> evaluator -> criterion -> score
  for (const r of rows) {
    const s = by.get(r.supplier_id) ?? new Map(); by.set(r.supplier_id, s);
    const e = s.get(r.ev) ?? new Map(); s.set(r.ev, e); e.set(r.criterion, r.score);
  }
  const out: GapRow[] = [];
  for (const [sid, evs] of by) {
    const finished = [...evs.values()].filter((m) => cfg.criteria.every((k) => m.has(k)));
    if (finished.length < 2) continue;
    for (const k of cfg.criteria) {
      const vals = finished.map((m) => m.get(k)!);
      const min = Math.min(...vals), max = Math.max(...vals), d = Math.round((max - min) * 10 * 100) / 100;
      if (d > gap) out.push({ supplierId: sid, supplierName: names.get(sid) ?? "", criterion: k, min, max, gap: d, reason: notes.get(`${sid}|${k}`) ?? null });
    }
  }
  return out.sort((a, b) => a.supplierName.localeCompare(b.supplierName) || a.criterion.localeCompare(b.criterion));
}

export async function pendingChanges(c: PoolClient, eventId: string, membershipId: string): Promise<PendingChange[]> {
  return (await c.query(`select sc.id, s.name as supplier, sc.criterion, sc.old_score::float8 as o, sc.new_score::float8 as n, sc.reason, u.email, sc.evaluator_membership_id as ev
      from score_change sc join supplier_org s on s.tenant_id = sc.tenant_id and s.id = sc.supplier_id
      join membership m on m.tenant_id = sc.tenant_id and m.id = sc.evaluator_membership_id join app_user u on u.id = m.user_id
     where sc.event_id = $1 and sc.needs_approval and sc.approved_at is null order by sc.at`, [eventId])).rows
    .map((r) => ({ id: r.id, supplierName: r.supplier, criterion: r.criterion, oldScore: r.o, newScore: r.n, reason: r.reason, evaluator: r.email, mine: r.ev === membershipId }));
}

export async function declarationOf(c: PoolClient, eventId: string, membershipId: string): Promise<"none" | "clear" | "conflict"> {
  const r = (await c.query(`select has_conflict from evaluator_declaration where event_id = $1 and membership_id = $2`, [eventId, membershipId])).rows[0];
  return !r ? "none" : r.has_conflict ? "conflict" : "clear";
}

/** An evaluator states, once and finally, whether they have a conflict of interest in this event. A conflict recuses them. */
export async function declareConflict(pool: Pool, who: Who, eventId: string, input: { conflict: boolean; detail: string }): Promise<CtlOut> {
  const detail = String(input.detail ?? "").trim();
  if (input.conflict && detail.length < MIN_REASON) return { ok: false, error: "Describe the conflict (at least 5 characters)." };
  if (detail.length > 1000) return { ok: false, error: "The description is too long (1,000 characters at most)." };
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev) return { ok: false as const, error: "Event not found." };
    const subject = await loadSubject(c, who.userId, eventId);
    if (!subject.ownRoles.has("tech_evaluator")) return { ok: false as const, error: "Only a technical evaluator of this event can declare." };
    if (["draft", "pending_publication"].includes(ev.state)) return { ok: false as const, error: "Declarations open once the event is published." };
    if ((await declarationOf(c, eventId, who.membershipId)) !== "none") return { ok: false as const, error: "You have already made your declaration." };
    await c.query(`insert into evaluator_declaration (tenant_id, event_id, membership_id, has_conflict, detail) values ($1,$2,$3,$4,$5)`, [who.tenantId, eventId, who.membershipId, input.conflict, input.conflict ? detail : ""]);
    await audit(c, internal(who), eventId, input.conflict ? "evaluator.recused" : "evaluator.declared_clear", {});
    return { ok: true as const };
  });
}

async function canModerate(c: PoolClient, who: Who, eventId: string) {
  const s = await loadSubject(c, who.userId, eventId);
  return who.role === "admin" || s.ownRoles.has("tech_approver");
}

/** The approver records why evaluators differ on a criterion. Approval of the technical result waits for this. */
export async function recordModeration(pool: Pool, who: Who, eventId: string, supplierId: string, criterion: string, reason: string): Promise<CtlOut> {
  const text = String(reason ?? "").trim();
  if (text.length < MIN_REASON) return { ok: false, error: "Give a reason (at least 5 characters)." };
  if (text.length > 1000) return { ok: false, error: "The reason is too long (1,000 characters at most)." };
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev) return { ok: false as const, error: "Event not found." };
    if (!(await canModerate(c, who, eventId))) return { ok: false as const, error: "Only the technical approver can record a moderation reason." };
    if (ev.state !== "technical_evaluation") return { ok: false as const, error: "Moderation is open only during technical evaluation." };
    const gaps = await moderationGaps(c, eventId, await resolveConfig(c, eventId));
    if (!gaps.some((g) => g.supplierId === supplierId && g.criterion === criterion)) return { ok: false as const, error: "There is no score difference to explain there." };
    await c.query(`insert into score_moderation (tenant_id, event_id, supplier_id, criterion, reason, by_membership) values ($1,$2,$3,$4,$5,$6)
                   on conflict (tenant_id, event_id, supplier_id, criterion) do update set reason = excluded.reason, by_membership = excluded.by_membership, at = now()`,
      [who.tenantId, eventId, supplierId, criterion, text, who.membershipId]);
    await audit(c, internal(who), eventId, "tech.moderated", { supplierId, criterion });
    return { ok: true as const };
  });
}

/** Approves a material score change made by an evaluator. Never the person who made it. */
export async function approveScoreChange(pool: Pool, who: Who, eventId: string, changeId: string): Promise<CtlOut> {
  return withTenant(pool, who.tenantId, async (c) => {
    if (!(await canModerate(c, who, eventId))) return { ok: false as const, error: "Only the technical approver can approve a score change." };
    const r = (await c.query(`select evaluator_membership_id as ev, needs_approval, approved_at from score_change where event_id = $1 and id = $2`, [eventId, changeId])).rows[0];
    if (!r || !r.needs_approval) return { ok: false as const, error: "Score change not found." };
    if (r.approved_at) return { ok: false as const, error: "That change is already approved." };
    if (r.ev === who.membershipId) return { ok: false as const, error: "You cannot approve your own score change." };
    await c.query(`update score_change set approved_by = $3, approved_at = now() where event_id = $1 and id = $2`, [eventId, changeId, who.membershipId]);
    await audit(c, internal(who), eventId, "tech.score_change_approved", { changeId });
    return { ok: true as const };
  });
}
