import type { Pool } from "pg";
import { audit, loadSubject, withTenant, type Actor } from "@/authz";
import type { Who } from "@/events/service";
import { currentAwards } from "@/lots/service";
import type { SupplierWho } from "@/suppliers/service";

export type JOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const internal = (w: Who): Actor => ({ kind: "internal", userId: w.userId, tenantId: w.tenantId });

export interface BidderValidity { supplierId: string; name: string; until: string | null; extended: boolean; expired: boolean }
export interface Debrief { supplierId: string; name: string; suggested: string; released: string | null; releasedAt: string | null }
export interface JourneyView { roles: string[]; state: string; validityDays: number | null; baseUntil: string | null; bidders: BidderValidity[]; debriefs: Debrief[] }

const day = (d: Date) => d.toISOString().slice(0, 10);
/** Closing date plus the validity period, as a calendar day. */
export function validUntil(closesAt: Date | string | null, days: number | null): string | null {
  if (!closesAt || !days) return null;
  const d = new Date(closesAt); d.setUTCDate(d.getUTCDate() + days); return day(d);
}

export async function getJourney(pool: Pool, who: Who, eventId: string, now = new Date()): Promise<JourneyView | null> {
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select ref, state::text as state, closes_at, quote_validity_days as days from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev) return null;
    const subject = await loadSubject(c, who.userId, eventId);
    const roles = [...subject.effectiveRoles] as string[];
    if (!roles.some((r) => ["buyer", "comm_evaluator", "award_approver", "auditor"].includes(r))) return null;
    const base = validUntil(ev.closes_at, ev.days);
    const bidders = (await c.query(`select distinct b.supplier_id, s.name, x.valid_until::text as ext from bid_revision b join supplier_org s on s.tenant_id = b.tenant_id and s.id = b.supplier_id
                                     left join quote_extension x on x.tenant_id = b.tenant_id and x.event_id = b.event_id and x.supplier_id = b.supplier_id where b.event_id = $1 order by s.name`, [eventId])).rows;
    const today = day(now);
    const out: BidderValidity[] = bidders.map((b) => { const until = (b.ext as string | null) ?? base; return { supplierId: b.supplier_id, name: b.name, until, extended: Boolean(b.ext), expired: Boolean(until) && until! < today }; });
    let debriefs: Debrief[] = [];
    if (ev.state === "awarded") {
      const won = new Set((await currentAwards(c, eventId)).map((a) => a.supplierId));
      const tech = new Map((await c.query(`select supplier_id, total::text as total, qualified from tech_result where event_id = $1`, [eventId])).rows.map((r) => [r.supplier_id as string, r]));
      const fb = new Map((await c.query(`select supplier_id, message, released_at from bid_feedback where event_id = $1`, [eventId])).rows.map((r) => [r.supplier_id as string, r]));
      const runs = (await c.query(`select outputs from calculation_run where event_id = $1 order by created_at desc limit 1`, [eventId])).rows[0]?.outputs as { rows?: { supplierId: string; rank: number; tech: string; commercial: string; final: string }[] } | undefined;
      const ranked = runs?.rows ?? [];
      debriefs = bidders.filter((b) => !won.has(b.supplier_id)).map((b) => {
        const t = tech.get(b.supplier_id), r = ranked.find((x) => x.supplierId === b.supplier_id), f = fb.get(b.supplier_id);
        const suggested = t && t.qualified === false
          ? `Thank you for bidding on ${ev.ref}. Your offer was evaluated technically and scored ${t.total} out of 100, which was below the minimum required to continue to the commercial stage. We welcome your participation in future events.`
          : r ? `Thank you for bidding on ${ev.ref}. Your offer ranked ${r.rank} of ${ranked.length} qualified bidders, with a technical score of ${r.tech}, a commercial score of ${r.commercial} and a final weighted score of ${r.final}. The contract was awarded to the bidder with the highest weighted score. We welcome your participation in future events.`
          : `Thank you for bidding on ${ev.ref}. After evaluation, the contract was awarded to another bidder. We welcome your participation in future events.`;
        return { supplierId: b.supplier_id, name: b.name, suggested, released: (f?.message as string | undefined) ?? null, releasedAt: f ? new Date(f.released_at).toISOString() : null };
      });
    }
    return { roles, state: ev.state, validityDays: ev.days ?? null, baseUntil: base, bidders: out, debriefs };
  });
}

async function buyerGuard(c: import("pg").PoolClient, who: Who, eventId: string): Promise<{ state: string; closesAt: Date | null } | string> {
  const ev = (await c.query(`select state::text as state, closes_at from sourcing_event where id = $1 for update`, [eventId])).rows[0];
  if (!ev) return "Event not found.";
  const s = await loadSubject(c, who.userId, eventId);
  if (!s.ownRoles.has("buyer")) return "Only the buyer can do this.";
  return { state: ev.state, closesAt: ev.closes_at };
}

export async function setQuoteValidity(pool: Pool, who: Who, eventId: string, days: number | null): Promise<JOut> {
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 730)) return { ok: false, error: "Enter a validity of 1 to 730 days." };
  return withTenant(pool, who.tenantId, async (c) => {
    const g = await buyerGuard(c, who, eventId); if (typeof g === "string") return { ok: false as const, error: g };
    if (["awarded", "cancelled", "archived"].includes(g.state)) return { ok: false as const, error: "The validity period can no longer be changed." };
    await c.query(`update sourcing_event set quote_validity_days = $2 where id = $1`, [eventId, days]);
    await audit(c, internal(who), eventId, "quote.validity_set", { days });
    return { ok: true as const };
  });
}

export async function recordExtension(pool: Pool, who: Who, eventId: string, supplierId: string, until: string): Promise<JOut> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || Number.isNaN(Date.parse(until))) return { ok: false, error: "Enter a valid date." };
  return withTenant(pool, who.tenantId, async (c) => {
    const g = await buyerGuard(c, who, eventId); if (typeof g === "string") return { ok: false as const, error: g };
    if (["draft", "pending_publication", "published", "awarded", "cancelled"].includes(g.state)) return { ok: false as const, error: "Extensions can be recorded after bids are opened and before the award." };
    if (!(await c.query(`select 1 from bid_revision where event_id = $1 and supplier_id = $2`, [eventId, supplierId])).rowCount) return { ok: false as const, error: "That supplier has not submitted a bid." };
    await c.query(`insert into quote_extension (tenant_id, event_id, supplier_id, valid_until, recorded_by) values ($1,$2,$3,$4,$5)
                   on conflict (tenant_id, event_id, supplier_id) do update set valid_until = excluded.valid_until, recorded_by = excluded.recorded_by, recorded_at = now()`, [who.tenantId, eventId, supplierId, until, who.membershipId]);
    await audit(c, internal(who), eventId, "quote.extended", { supplierId, until });
    return { ok: true as const };
  });
}

export async function releaseFeedback(pool: Pool, who: Who, eventId: string, supplierId: string, message: string): Promise<JOut> {
  const text = String(message ?? "").trim();
  if (text.length < 10 || text.length > 2000) return { ok: false, error: "Write the feedback in 10 to 2,000 characters." };
  return withTenant(pool, who.tenantId, async (c) => {
    const g = await buyerGuard(c, who, eventId); if (typeof g === "string") return { ok: false as const, error: g };
    if (g.state !== "awarded") return { ok: false as const, error: "Feedback can be sent once the event is awarded." };
    if (!(await c.query(`select 1 from bid_revision where event_id = $1 and supplier_id = $2`, [eventId, supplierId])).rowCount) return { ok: false as const, error: "That supplier did not bid." };
    if ((await currentAwards(c, eventId)).some((a) => a.supplierId === supplierId)) return { ok: false as const, error: "Feedback is for bidders that were not awarded." };
    await c.query(`insert into bid_feedback (tenant_id, event_id, supplier_id, message, released_by) values ($1,$2,$3,$4,$5)
                   on conflict (tenant_id, event_id, supplier_id) do update set message = excluded.message, released_by = excluded.released_by, released_at = now()`, [who.tenantId, eventId, supplierId, text, who.membershipId]);
    await audit(c, internal(who), eventId, "feedback.released", { supplierId });
    return { ok: true as const };
  });
}

/** What a supplier sees: only its own feedback for this event. */
export async function feedbackForSupplier(pool: Pool, who: SupplierWho, eventId: string): Promise<{ message: string; at: string } | null> {
  return withTenant(pool, who.tenantId, async (c) => {
    const r = (await c.query(`select message, released_at from bid_feedback where event_id = $1 and supplier_id = $2`, [eventId, who.supplierId])).rows[0];
    return r ? { message: r.message as string, at: new Date(r.released_at).toISOString() } : null;
  });
}

/** The date this supplier's quote should remain valid until (its own extension if recorded, else closing date + validity days). */
export async function validityForSupplier(pool: Pool, who: SupplierWho, eventId: string): Promise<string | null> {
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select closes_at, quote_validity_days as days from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev) return null;
    const x = (await c.query(`select valid_until::text as v from quote_extension where event_id = $1 and supplier_id = $2`, [eventId, who.supplierId])).rows[0];
    return (x?.v as string | undefined) ?? validUntil(ev.closes_at, ev.days);
  });
}
