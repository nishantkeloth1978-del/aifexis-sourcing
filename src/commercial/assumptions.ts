import type { Pool, PoolClient } from "pg";
import { audit, loadSubject, withTenant, type Actor } from "@/authz";
import { formatDec, parseDec, roundDiv } from "@/engine";
import type { Who } from "@/events/service";

export type AsOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface Assumption { id: string; label: string; kind: "pct" | "amount"; values: Record<string, string> }
const internal = (w: Who): Actor => ({ kind: "internal", userId: w.userId, tenantId: w.tenantId });

export async function listAssumptions(c: PoolClient, eventId: string): Promise<Assumption[]> {
  const a = (await c.query(`select id, label, kind from tco_assumption where event_id = $1 order by created_at, label`, [eventId])).rows;
  if (!a.length) return [];
  const v = (await c.query(`select assumption_id, supplier_id, value::text as value from tco_value where assumption_id = any($1::uuid[])`, [a.map((x) => x.id)])).rows;
  return a.map((x) => ({ id: x.id, label: x.label, kind: x.kind, values: Object.fromEntries(v.filter((y) => y.assumption_id === x.id).map((y) => [y.supplier_id, String(y.value).replace(/\.?0+$/, "") || "0"])) }));
}

/** Extra cost of one assumption on a bid total (scale 2). Percentages are of the bid total, rounded half up. */
export function extraOf(kind: "pct" | "amount", value: string, bid: bigint): bigint {
  if (kind === "amount") return parseDec(value, 2) ?? 0n;
  return roundDiv(bid * (parseDec(value, 4) ?? 0n), 1000000n);
}
export const fmt2 = (n: bigint) => formatDec(n, 2, false);

async function guard(c: PoolClient, who: Who, eventId: string): Promise<string | null> {
  const ev = (await c.query(`select state::text as state from sourcing_event where id = $1 for update`, [eventId])).rows[0];
  if (!ev) return "Event not found.";
  const s = await loadSubject(c, who.userId, eventId);
  if (!(s.ownRoles.has("buyer") || s.ownRoles.has("comm_evaluator"))) return "Only the buyer or a commercial evaluator can change evaluation assumptions.";
  if (ev.state !== "commercial_evaluation") return "Assumptions can be changed during commercial evaluation, before a recommendation.";
  return null;
}

export async function addAssumption(pool: Pool, who: Who, eventId: string, input: { label: string; kind: string }): Promise<AsOut> {
  const label = String(input.label ?? "").trim().replace(/\s+/g, " ");
  if (label.length < 2 || label.length > 80) return { ok: false, error: "Name the assumption in 2 to 80 characters." };
  if (input.kind !== "pct" && input.kind !== "amount") return { ok: false, error: "Choose a percentage or an amount." };
  return withTenant(pool, who.tenantId, async (c) => {
    const err = await guard(c, who, eventId); if (err) return { ok: false as const, error: err };
    if (((await c.query(`select count(*)::int n from tco_assumption where event_id = $1`, [eventId])).rows[0].n as number) >= 10) return { ok: false as const, error: "Use at most 10 assumptions." };
    try { await c.query(`insert into tco_assumption (tenant_id, event_id, label, kind, created_by) values ($1,$2,$3,$4,$5)`, [who.tenantId, eventId, label, input.kind, who.membershipId]); }
    catch (e) { if ((e as { code?: string }).code === "23505") return { ok: false as const, error: "There is already an assumption with that name." }; throw e; }
    await audit(c, internal(who), eventId, "tco.assumption_added", { label, kind: input.kind });
    return { ok: true as const };
  });
}

export async function setAssumptionValue(pool: Pool, who: Who, eventId: string, assumptionId: string, supplierId: string, value: string): Promise<AsOut> {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,14}(\.\d{1,4})?$/.test(raw)) return { ok: false, error: "Enter a number of 0 or more, with up to 4 decimals." };
  return withTenant(pool, who.tenantId, async (c) => {
    const err = await guard(c, who, eventId); if (err) return { ok: false as const, error: err };
    const a = (await c.query(`select kind from tco_assumption where event_id = $1 and id = $2`, [eventId, assumptionId])).rows[0];
    if (!a) return { ok: false as const, error: "Assumption not found." };
    if (a.kind === "pct" && Number(raw) > 1000) return { ok: false as const, error: "A percentage cannot be above 1000." };
    const q = (await c.query(`select 1 from tech_result where event_id = $1 and supplier_id = $2 and qualified`, [eventId, supplierId])).rowCount;
    if (!q) return { ok: false as const, error: "That supplier is not a qualified bidder." };
    await c.query(`insert into tco_value (tenant_id, assumption_id, supplier_id, value, set_by) values ($1,$2,$3,$4,$5)
                   on conflict (tenant_id, assumption_id, supplier_id) do update set value = excluded.value, set_by = excluded.set_by, set_at = now()`, [who.tenantId, assumptionId, supplierId, raw, who.membershipId]);
    await audit(c, internal(who), eventId, "tco.value_set", { assumptionId, supplierId, value: raw });
    return { ok: true as const };
  });
}

export async function deleteAssumption(pool: Pool, who: Who, eventId: string, assumptionId: string): Promise<AsOut> {
  return withTenant(pool, who.tenantId, async (c) => {
    const err = await guard(c, who, eventId); if (err) return { ok: false as const, error: err };
    const r = await c.query(`delete from tco_assumption where event_id = $1 and id = $2`, [eventId, assumptionId]);
    if (!r.rowCount) return { ok: false as const, error: "Assumption not found." };
    await audit(c, internal(who), eventId, "tco.assumption_removed", { assumptionId });
    return { ok: true as const };
  });
}
