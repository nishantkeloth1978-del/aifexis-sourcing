import type { Pool, PoolClient } from "pg";
import { resolvePermitted, withTenant } from "@/authz";
import type { SupplierWho } from "@/suppliers/service";
import type { Tier } from "@/boq/tiers";

/** What a supplier has typed but not yet submitted. Plain strings only; the server checks everything again on submit. */
export interface DraftValues {
  prices: Record<string, string>; tiers: Record<string, Tier[]>; technicalText: string; gates: Record<string, boolean>;
  answers: Record<string, unknown>; alternates: { label: string; note: string; prices: Record<string, string> }[]; bundles: { lotIds: string[]; discountPct: string }[];
  laneTerms: Record<string, Record<string, string>>;
}
export interface Draft { values: DraftValues; savedAt: string; baseRevision: number }
export type DraftOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export const MAX_DRAFT_BYTES = 400_000;

const str = (v: unknown, max = 20000) => (typeof v === "string" ? v.slice(0, max) : "");
const strMap = (v: unknown, max = 2000) => Object.fromEntries(Object.entries((v && typeof v === "object" ? v : {}) as Record<string, unknown>).slice(0, 5000).map(([k, x]) => [k.slice(0, 80), str(x, 200)]));

function cleanAnswers(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const json = JSON.stringify(v);
  return json.length > 200_000 ? {} : (JSON.parse(json) as Record<string, unknown>);
}

/** Keeps only the shapes the form uses; anything else typed into the request is dropped. */
export function cleanDraft(raw: unknown): DraftValues {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tiers = Object.fromEntries(Object.entries((r.tiers && typeof r.tiers === "object" ? r.tiers : {}) as Record<string, unknown>).slice(0, 5000)
    .map(([k, v]) => [k.slice(0, 80), (Array.isArray(v) ? v : []).slice(0, 4).map((t) => ({ minQty: str((t as Tier)?.minQty, 30), unitPrice: str((t as Tier)?.unitPrice, 30) }))]));
  const gates = Object.fromEntries(Object.entries((r.gates && typeof r.gates === "object" ? r.gates : {}) as Record<string, unknown>).slice(0, 50).filter(([, v]) => typeof v === "boolean").map(([k, v]) => [k.slice(0, 200), v as boolean]));
  const lt = (r.laneTerms && typeof r.laneTerms === "object" ? r.laneTerms : {}) as Record<string, unknown>;
  const laneTerms = Object.fromEntries(Object.entries(lt).slice(0, 200).map(([k, v]) => [k.slice(0, 80), Object.fromEntries(Object.entries((v && typeof v === "object" ? v : {}) as Record<string, unknown>).slice(0, 12).map(([a, x]) => [a.slice(0, 60), str(x, 200)]))]));
  return {
    laneTerms, prices: strMap(r.prices), tiers, technicalText: str(r.technicalText), gates,
    answers: cleanAnswers(r.answers),
    alternates: (Array.isArray(r.alternates) ? r.alternates : []).slice(0, 2).map((a) => ({ label: str((a as { label?: unknown })?.label, 60), note: str((a as { note?: unknown })?.note, 1000), prices: strMap((a as { prices?: unknown })?.prices) })),
    bundles: (Array.isArray(r.bundles) ? r.bundles : []).slice(0, 5).map((b) => ({ lotIds: (Array.isArray((b as { lotIds?: unknown })?.lotIds) ? (b as { lotIds: unknown[] }).lotIds : []).slice(0, 50).map((x) => str(x, 40)), discountPct: str((b as { discountPct?: unknown })?.discountPct, 10) })),
  };
}

export async function readDraft(c: PoolClient, eventId: string, supplierId: string, currentRevision: number): Promise<Draft | null> {
  const r = (await c.query(`select payload, saved_at, base_revision from bid_draft where event_id = $1 and supplier_id = $2`, [eventId, supplierId])).rows[0];
  if (!r || r.base_revision !== currentRevision) return null;   // a newer submission replaced what this draft was based on
  return { values: cleanDraft(r.payload), savedAt: new Date(r.saved_at).toISOString(), baseRevision: r.base_revision };
}

export async function saveDraft(pool: Pool, who: SupplierWho, eventId: string, raw: unknown): Promise<DraftOut<{ savedAt: string }>> {
  const values = cleanDraft(raw);
  if (JSON.stringify(values).length > MAX_DRAFT_BYTES) return { ok: false, error: "The draft is too large to save." };
  return withTenant(pool, who.tenantId, async (c) => {
    const r = await resolvePermitted(c, { kind: "supplier", supplierUserId: who.supplierUserId, tenantId: who.tenantId }, eventId);
    if (!r.ok) return { ok: false as const, error: "This event is not available to you." };
    if (r.event.state !== "published" || (r.event.closesAt && r.event.closesAt.getTime() <= Date.now())) return { ok: false as const, error: "This event is no longer open for bids." };
    const rev = (await c.query(`select coalesce(max(revision_no), 0)::int n from bid_revision where event_id = $1 and supplier_id = $2`, [eventId, who.supplierId])).rows[0].n as number;
    const row = (await c.query(`insert into bid_draft (tenant_id, event_id, supplier_id, base_revision, payload) values ($1,$2,$3,$4,$5)
                                on conflict (tenant_id, event_id, supplier_id) do update set base_revision = excluded.base_revision, payload = excluded.payload, saved_at = now() returning saved_at`,
      [who.tenantId, eventId, who.supplierId, rev, JSON.stringify(values)])).rows[0];
    return { ok: true as const, savedAt: new Date(row.saved_at).toISOString() };
  });
}

export async function discardDraft(pool: Pool, who: SupplierWho, eventId: string): Promise<DraftOut> {
  await withTenant(pool, who.tenantId, (c) => c.query(`delete from bid_draft where event_id = $1 and supplier_id = $2`, [eventId, who.supplierId]));
  return { ok: true };
}
