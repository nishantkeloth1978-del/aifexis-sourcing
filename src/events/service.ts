import type { Pool } from "pg";
import { audit, withTenant } from "@/authz";

export interface Who { tenantId: string; userId: string; membershipId: string; role: string }

export interface EventSummary {
  id: string; ref: string; title: string; ownerDept: string; state: string;
  valueAed: string | null; closesAt: string | null; currency: string; createdAt: string;
}

export interface CreateInput { title: string; ownerDept?: string; closesAt?: string }
export type CreateResult = { ok: true; event: EventSummary } | { ok: false; error: string };

const CAN_CREATE = new Set(["admin", "member"]);

export function validate(input: CreateInput): { ok: true; value: { title: string; ownerDept: string; closesAt: string | null } } | { ok: false; error: string } {
  const title = (input.title ?? "").trim();
  if (title.length < 3) return { ok: false, error: "Enter a title of at least 3 characters." };
  if (title.length > 200) return { ok: false, error: "The title is too long (200 characters at most)." };
  const ownerDept = (input.ownerDept ?? "").trim().slice(0, 100);
  let closesAt: string | null = null;
  if (input.closesAt) {
    const d = new Date(input.closesAt);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "The closing date is not valid." };
    closesAt = d.toISOString();
  }
  return { ok: true, value: { title, ownerDept, closesAt } };
}

const SELECT = `select id, ref, title, coalesce(owner_dept, '') as owner_dept, state::text as state, value_aed::text as value_aed,
                       closes_at, currency, created_at from sourcing_event`;

const map = (r: Record<string, unknown>): EventSummary => ({
  id: r.id as string, ref: r.ref as string, title: r.title as string, ownerDept: r.owner_dept as string, state: r.state as string,
  valueAed: (r.value_aed as string | null) ?? null, closesAt: r.closes_at ? new Date(r.closes_at as string).toISOString() : null,
  currency: r.currency as string, createdAt: new Date(r.created_at as string).toISOString(),
});

export async function listEvents(pool: Pool, who: Who): Promise<EventSummary[]> {
  return withTenant(pool, who.tenantId, async (c) => (await c.query(`${SELECT} order by created_at desc, ref desc limit 200`)).rows.map(map));
}

export async function createEvent(pool: Pool, who: Who, input: CreateInput): Promise<CreateResult> {
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot create events." };
  const v = validate(input);
  if (!v.ok) return v;
  return withTenant(pool, who.tenantId, async (c) => {
    const year = new Date().getUTCFullYear();
    const n = (await c.query(
      `insert into event_counter (tenant_id, year, last) values ($1, $2, 1)
       on conflict (tenant_id, year) do update set last = event_counter.last + 1 returning last`, [who.tenantId, year])).rows[0].last as number;
    const ref = `EV-${year}-${String(n).padStart(3, "0")}`;
    const row = (await c.query(
      `insert into sourcing_event (tenant_id, title, ref, owner_dept, closes_at, created_by)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [who.tenantId, v.value.title, ref, v.value.ownerDept || null, v.value.closesAt, who.membershipId])).rows[0];
    await c.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1, $2, $3, 'requester')`,
      [who.tenantId, row.id, who.membershipId]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, row.id, "event.created", { ref, title: v.value.title });
    const out = (await c.query(`${SELECT} where id = $1`, [row.id])).rows[0];
    return { ok: true as const, event: map(out) };
  });
}

// ---------- event detail and line items ----------

export interface EventItem { id: string; lineNo: number; description: string; quantity: string; unit: string; blockType: string }
export interface EventDetail extends EventSummary { items: EventItem[]; stateVersion: number }
export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const mapItem = (r: Record<string, unknown>): EventItem => ({
  id: r.id as string, lineNo: r.line_no as number, description: r.description as string,
  quantity: r.quantity as string, unit: r.unit as string, blockType: r.block_type as string,
});

export async function getEvent(pool: Pool, who: Who, id: string): Promise<EventDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withTenant(pool, who.tenantId, async (c) => {
    const e = (await c.query(`${SELECT} where id = $1`, [id])).rows[0];
    if (!e) return null;
    const v = (await c.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;
    const items = (await c.query(`select id, line_no, description, quantity::text, unit, block_type from event_item where event_id = $1 order by line_no`, [id])).rows.map(mapItem);
    return { ...map(e), items, stateVersion: v };
  });
}

export interface ItemInput { description: string; quantity: string; unit: string }
function validateItem(i: ItemInput): { ok: true; value: { description: string; quantity: string; unit: string } } | { ok: false; error: string } {
  const description = (i.description ?? "").trim();
  const unit = (i.unit ?? "").trim();
  const q = (i.quantity ?? "").trim();
  if (!description) return { ok: false, error: "Enter a description." };
  if (description.length > 500) return { ok: false, error: "The description is too long (500 characters at most)." };
  if (!/^\d{1,15}(\.\d{1,3})?$/.test(q) || Number(q) <= 0) return { ok: false, error: "Quantity must be a positive number with up to 3 decimals." };
  if (!unit || unit.length > 20) return { ok: false, error: "Enter a unit (for example EA, M, KG, HR)." };
  return { ok: true, value: { description, quantity: q, unit } };
}

async function lockDraft(c: import("pg").PoolClient, eventId: string): Promise<string | null> {
  const r = (await c.query(`select state::text as state from sourcing_event where id = $1 for update`, [eventId])).rows[0];
  if (!r) return "Event not found.";
  if (r.state !== "draft") return "This event is no longer a draft, so its items cannot be changed.";
  return null;
}

export async function addItem(pool: Pool, who: Who, eventId: string, input: ItemInput): Promise<Result<{ item: EventItem }>> {
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot edit events." };
  const v = validateItem(input);
  if (!v.ok) return v;
  return withTenant(pool, who.tenantId, async (c) => {
    const err = await lockDraft(c, eventId);
    if (err) return { ok: false as const, error: err };
    const n = (await c.query(`select coalesce(max(line_no), 0) + 1 as n from event_item where event_id = $1`, [eventId])).rows[0].n as number;
    const row = (await c.query(
      `insert into event_item (tenant_id, event_id, line_no, description, quantity, unit) values ($1, $2, $3, $4, $5, $6)
       returning id, line_no, description, quantity::text, unit, block_type`,
      [who.tenantId, eventId, n, v.value.description, v.value.quantity, v.value.unit])).rows[0];
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "item.added", { lineNo: n });
    return { ok: true as const, item: mapItem(row) };
  });
}

export async function deleteItem(pool: Pool, who: Who, eventId: string, itemId: string): Promise<Result<object>> {
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot edit events." };
  return withTenant(pool, who.tenantId, async (c) => {
    const err = await lockDraft(c, eventId);
    if (err) return { ok: false as const, error: err };
    const d = await c.query(`delete from event_item where id = $1 and event_id = $2`, [itemId, eventId]);
    if (!d.rowCount) return { ok: false as const, error: "Item not found." };
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "item.deleted", { itemId });
    return { ok: true as const };
  });
}

export async function updateEventBasics(pool: Pool, who: Who, eventId: string, input: CreateInput): Promise<Result<{ event: EventSummary }>> {
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot edit events." };
  const v = validate(input);
  if (!v.ok) return v;
  return withTenant(pool, who.tenantId, async (c) => {
    const err = await lockDraft(c, eventId);
    if (err) return { ok: false as const, error: err };
    await c.query(`update sourcing_event set title = $2, owner_dept = $3, closes_at = $4 where id = $1`,
      [eventId, v.value.title, v.value.ownerDept || null, v.value.closesAt]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "event.updated", { title: v.value.title });
    return { ok: true as const, event: map((await c.query(`${SELECT} where id = $1`, [eventId])).rows[0]) };
  });
}
