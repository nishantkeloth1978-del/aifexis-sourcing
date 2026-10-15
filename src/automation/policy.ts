import type { Pool } from "pg";
import { withTenant } from "@/authz";
import { audit } from "@/authz/service";
import { can } from "@/access/permissions";
import type { Who } from "@/events/service";

import { DEFAULT_POLICY, REMINDER_CHOICES, type AutoAction, type Policy } from "./policy-types";
export { DEFAULT_POLICY, REMINDER_CHOICES };
export type { AutoAction, Policy };

export const P_NO_PERM = "Only an administrator can change the automation settings.";
export const P_BAD = "Check the automation settings: reminder days, extension hours (1 to 168), minimum bids (1 to 50) and nudge hours (0 to 336).";
export const P_FAILED = "That could not be saved. Try again.";
export const POLICY_MESSAGES = [P_NO_PERM, P_BAD, P_FAILED];

export async function getPolicy(pool: Pool, tenantId: string): Promise<Policy> {
  return withTenant(pool, tenantId, (c) => policyOf(c));
}
export async function policyOf(c: { query: (q: string) => Promise<{ rows: any[] }> }): Promise<Policy> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = (await c.query(`select paused, reminder_days, extend_enabled, extend_hours, extend_min_bids, nudge_hours from autonomy_policy`)).rows[0];
  if (!r) return DEFAULT_POLICY;
  return { paused: r.paused, reminderDays: [...(r.reminder_days as number[])].sort((a, b) => b - a), extendEnabled: r.extend_enabled, extendHours: r.extend_hours, extendMinBids: r.extend_min_bids, nudgeHours: r.nudge_hours };
}

const int = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

export async function savePolicy(pool: Pool, who: Who, input: unknown): Promise<{ ok: true; policy: Policy } | { ok: false; error: string }> {
  if (!can(who, "config.manage")) return { ok: false, error: P_NO_PERM };
  const a = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const days = a.reminderDays;
  if (typeof a.paused !== "boolean" || typeof a.extendEnabled !== "boolean" || !Array.isArray(days) || days.length > 4 || !days.every((d) => REMINDER_CHOICES.includes(d as never)) || new Set(days).size !== days.length
    || !int(a.extendHours, 1, 168) || !int(a.extendMinBids, 1, 50) || !int(a.nudgeHours, 0, 336)) return { ok: false, error: P_BAD };
  const p: Policy = { paused: a.paused, reminderDays: [...(days as number[])].sort((x, y) => y - x), extendEnabled: a.extendEnabled, extendHours: a.extendHours as number, extendMinBids: a.extendMinBids as number, nudgeHours: a.nudgeHours as number };
  await withTenant(pool, who.tenantId, async (c) => {
    await c.query(`insert into autonomy_policy (tenant_id, paused, reminder_days, extend_enabled, extend_hours, extend_min_bids, nudge_hours, updated_by, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8, now())
                   on conflict (tenant_id) do update set paused = $2, reminder_days = $3, extend_enabled = $4, extend_hours = $5, extend_min_bids = $6, nudge_hours = $7, updated_by = $8, updated_at = now()`,
      [who.tenantId, p.paused, p.reminderDays, p.extendEnabled, p.extendHours, p.extendMinBids, p.nudgeHours, who.membershipId]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "autonomy.policy", p);
  });
  return { ok: true, policy: p };
}

/** The most recent automatic actions, for the Configuration screen. */
export async function recentActions(pool: Pool, tenantId: string, limit = 15): Promise<AutoAction[]> {
  return withTenant(pool, tenantId, async (c) => (await c.query(
    `select a.at, a.action, coalesce(e.ref, '') as ref, coalesce(a.detail->>'text', '') as text
       from audit_event a left join sourcing_event e on e.tenant_id = a.tenant_id and e.id = a.event_id
      where a.action like 'autonomy.auto%' order by a.id desc limit $1`, [limit])).rows
    .map((r) => ({ at: new Date(r.at).toISOString(), action: r.action as string, ref: r.ref as string, detail: r.text as string })));
}
