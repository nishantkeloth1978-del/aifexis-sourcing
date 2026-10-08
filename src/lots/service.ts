import type { Pool, PoolClient } from "pg";
import { audit, withTenant } from "@/authz";
import type { Who } from "@/events/service";

/** Lots split one event into parts that are priced, ranked and awarded on their own. See docs/LOTS_DESIGN.md. */
export interface Lot { id: string; lotNo: number; name: string }
export type LResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export const MAX_LOTS = 50;
const CAN_EDIT = new Set(["admin", "member"]);

export async function lotsOf(c: PoolClient, eventId: string): Promise<Lot[]> {
  return (await c.query(`select id, lot_no, name from event_lot where event_id = $1 order by lot_no`, [eventId])).rows
    .map((r) => ({ id: r.id as string, lotNo: r.lot_no as number, name: r.name as string }));
}

export function cleanLotName(raw: unknown): string | null {
  const n = String(raw ?? "").trim().replace(/\s+/g, " ");
  return n.length >= 1 && n.length <= 120 ? n : null;
}

async function lockDraft(c: PoolClient, eventId: string): Promise<string | null> {
  const r = (await c.query(`select state::text as state from sourcing_event where id = $1 for update`, [eventId])).rows[0];
  if (!r) return "Event not found.";
  if (r.state !== "draft") return "This event is no longer a draft, so its lots cannot be changed.";
  return null;
}

/** The id of the lot with this name (any capitals) on the event; created if it is new. Caller holds the draft lock. */
export async function findOrCreateLot(c: PoolClient, tenantId: string, eventId: string, name: string): Promise<string | { error: string }> {
  const found = (await c.query(`select id from event_lot where event_id = $1 and lower(name) = lower($2)`, [eventId, name])).rows[0];
  if (found) return found.id as string;
  const cur = (await c.query(`select coalesce(max(lot_no), 0) as n, count(*)::int as cnt from event_lot where event_id = $1`, [eventId])).rows[0];
  if (cur.cnt >= MAX_LOTS) return { error: `An event can have at most ${MAX_LOTS} lots.` };
  return (await c.query(`insert into event_lot (tenant_id, event_id, lot_no, name) values ($1,$2,$3,$4) returning id`, [tenantId, eventId, cur.n + 1, name])).rows[0].id as string;
}

export async function addLot(pool: Pool, who: Who, eventId: string, rawName: string): Promise<LResult<{ lot: Lot }>> {
  if (!CAN_EDIT.has(who.role)) return { ok: false, error: "Your role cannot edit events." };
  const name = cleanLotName(rawName);
  if (!name) return { ok: false, error: "Enter a lot name of up to 120 characters." };
  return withTenant(pool, who.tenantId, async (c) => {
    const err = await lockDraft(c, eventId);
    if (err) return { ok: false as const, error: err };
    if ((await c.query(`select 1 from event_lot where event_id = $1 and lower(name) = lower($2)`, [eventId, name])).rowCount) return { ok: false as const, error: "There is already a lot with that name." };
    const id = await findOrCreateLot(c, who.tenantId, eventId, name);
    if (typeof id !== "string") return { ok: false as const, error: id.error };
    const lot = (await lotsOf(c, eventId)).find((l) => l.id === id)!;
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "lot.added", { lotNo: lot.lotNo, name });
    return { ok: true as const, lot };
  });
}

/** Removing a lot keeps its items; they simply have no lot until one is chosen. */
export async function deleteLot(pool: Pool, who: Who, eventId: string, lotId: string): Promise<LResult> {
  if (!CAN_EDIT.has(who.role)) return { ok: false, error: "Your role cannot edit events." };
  return withTenant(pool, who.tenantId, async (c) => {
    const err = await lockDraft(c, eventId);
    if (err) return { ok: false as const, error: err };
    await c.query(`update event_item set lot_id = null where event_id = $1 and lot_id = $2`, [eventId, lotId]);
    const d = await c.query(`delete from event_lot where event_id = $1 and id = $2`, [eventId, lotId]);
    if (!d.rowCount) return { ok: false as const, error: "Lot not found." };
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "lot.deleted", { lotId });
    return { ok: true as const };
  });
}

export async function setItemLot(pool: Pool, who: Who, eventId: string, itemId: string, lotId: string | null): Promise<LResult> {
  if (!CAN_EDIT.has(who.role)) return { ok: false, error: "Your role cannot edit events." };
  return withTenant(pool, who.tenantId, async (c) => {
    const err = await lockDraft(c, eventId);
    if (err) return { ok: false as const, error: err };
    if (lotId && !(await c.query(`select 1 from event_lot where event_id = $1 and id = $2`, [eventId, lotId])).rowCount) return { ok: false as const, error: "Lot not found." };
    const u = await c.query(`update event_item set lot_id = $3 where event_id = $1 and id = $2`, [eventId, itemId, lotId]);
    if (!u.rowCount) return { ok: false as const, error: "Item not found." };
    return { ok: true as const };
  });
}

/** What stops this event from being published as far as lots go; null when all is well. */
export async function lotProblem(c: PoolClient, eventId: string): Promise<string | null> {
  const n = (await c.query(`select count(*)::int as n from event_lot where event_id = $1`, [eventId])).rows[0].n as number;
  if (!n) return null;
  const loose = (await c.query(`select count(*)::int as n from event_item where event_id = $1 and lot_id is null`, [eventId])).rows[0].n as number;
  if (loose) return `Put every item in a lot before submitting (${loose} without a lot).`;
  const empty = (await c.query(`select count(*)::int as n from event_lot l where l.event_id = $1 and not exists (select 1 from event_item i where i.event_id = l.event_id and i.lot_id = l.id)`, [eventId])).rows[0].n as number;
  if (empty) return `Every lot needs at least one item. Remove or fill the empty lots (${empty}).`;
  return null;
}

// ---------- awards ----------

export interface Award {
  lotId: string | null; lotNo: number | null; lotName: string | null;
  supplierId: string; supplierName: string; contactEmail: string | null; note: string;
  total: string | null;              // the winner's price for this lot (or for the whole event when there are no lots)
}
interface PriceLines { lines?: { lotId?: string }[]; lots?: { lotId: string; total: string }[]; total?: string }

/** The supplier's most recent price_lines payload for the event. */
export async function latestPrices(c: PoolClient, eventId: string, supplierId: string): Promise<PriceLines | undefined> {
  return (await c.query(`select bi.payload from bid_item bi join bid_revision br on br.tenant_id = bi.tenant_id and br.id = bi.bid_revision_id
                          where br.event_id = $1 and br.supplier_id = $2 and bi.kind = 'price_lines' order by br.revision_no desc limit 1`, [eventId, supplierId])).rows[0]?.payload as PriceLines | undefined;
}

/** The current recommendation: the rows saved together by the latest recommendation. One per lot, or one for the whole event. */
export async function currentAwards(c: PoolClient, eventId: string): Promise<Award[]> {
  const rows = (await c.query(
    `select r.lot_id, l.lot_no, l.name as lot_name, r.supplier_id, s.name, s.contact_email, r.note
       from recommendation r
       join supplier_org s on s.tenant_id = r.tenant_id and s.id = r.supplier_id
       left join event_lot l on l.tenant_id = r.tenant_id and l.id = r.lot_id
      where r.event_id = $1 and r.created_at = (select max(created_at) from recommendation where event_id = $1)
      order by l.lot_no nulls first`, [eventId])).rows;
  const out: Award[] = [];
  for (const r of rows) {
    const p = await latestPrices(c, eventId, r.supplier_id);
    const total = r.lot_id ? p?.lots?.find((x) => x.lotId === r.lot_id)?.total ?? null : p?.total ?? null;
    out.push({ lotId: r.lot_id ?? null, lotNo: r.lot_no ?? null, lotName: r.lot_name ?? null, supplierId: r.supplier_id, supplierName: r.name, contactEmail: r.contact_email ?? null, note: r.note, total });
  }
  return out;
}

/** Number of lots on the event that have no award in the current recommendation. */
export async function unawardedLots(c: PoolClient, eventId: string): Promise<number> {
  return (await c.query(
    `select count(*)::int as n from event_lot l where l.event_id = $1 and not exists (
       select 1 from recommendation r where r.event_id = l.event_id and r.lot_id = l.id and r.created_at = (select max(created_at) from recommendation where event_id = l.event_id))`, [eventId])).rows[0].n as number;
}
