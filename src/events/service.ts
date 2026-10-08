import type { Pool } from "pg";
import { audit, withTenant } from "@/authz";

export interface Who { tenantId: string; userId: string; membershipId: string; role: string }

export interface EventSummary {
  id: string; ref: string; title: string; ownerDept: string; state: string;
  valueAed: string | null; closesAt: string | null; currency: string; createdAt: string;
}

export interface CreateInput { title: string; ownerDept?: string; closesAt?: string; valueAed?: string }

/** Estimated value in AED: empty clears it, otherwise a non-negative amount with up to 2 decimals. */
export function parseValue(raw: string | undefined): { ok: true; value: string | null } | { ok: false; error: string } {
  const t = (raw ?? "").trim().replace(/,/g, "");
  if (!t) return { ok: true, value: null };
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(t)) return { ok: false, error: "Enter the estimated value as an amount in AED, for example 250000." };
  return { ok: true, value: t };
}
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
export function validateItem(i: ItemInput): { ok: true; value: { description: string; quantity: string; unit: string } } | { ok: false; error: string } {
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
    const val = parseValue(input.valueAed);
    if (!val.ok) return val;
    await c.query(`update sourcing_event set title = $2, owner_dept = $3, closes_at = $4, value_aed = case when $5::boolean then $6::numeric else value_aed end where id = $1`,
      [eventId, v.value.title, v.value.ownerDept || null, v.value.closesAt, input.valueAed !== undefined, val.value]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "event.updated", { title: v.value.title });
    return { ok: true as const, event: map((await c.query(`${SELECT} where id = $1`, [eventId])).rows[0]) };
  });
}

// ---------- bulk import and duplicate ----------

export interface ImportRow { description: string; quantity: string; unit: string; blockType: "UNIT_PRICE" | "LUMP_SUM" }
export const MAX_LINES = 500;

/** Adds many lines in one step, all or nothing. Every row is validated again here, whatever the browser sent. */
export async function importItems(pool: Pool, who: Who, eventId: string, rows: ImportRow[]): Promise<Result<{ added: number }>> {
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot edit events." };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "There are no lines to import." };
  if (rows.length > 200) return { ok: false, error: "Import at most 200 lines at a time." };
  const clean: ImportRow[] = [];
  for (const [i, r] of rows.entries()) {
    const v = validateItem(r);
    if (!v.ok) return { ok: false, error: `Row ${i + 1}: ${v.error}` };
    clean.push({ ...v.value, blockType: r.blockType === "LUMP_SUM" ? "LUMP_SUM" : "UNIT_PRICE" });
  }
  return withTenant(pool, who.tenantId, async (c) => {
    const err = await lockDraft(c, eventId);
    if (err) return { ok: false as const, error: err };
    const cur = (await c.query(`select coalesce(max(line_no), 0) as n, count(*)::int as cnt from event_item where event_id = $1`, [eventId])).rows[0];
    if (cur.cnt + clean.length > MAX_LINES) return { ok: false as const, error: `An event can have at most ${MAX_LINES} lines.` };
    let n = cur.n as number;
    for (const r of clean) {
      n += 1;
      await c.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type) values ($1,$2,$3,$4,$5,$6,$7)`, [who.tenantId, eventId, n, r.description, r.quantity, r.unit.toUpperCase(), r.blockType]);
    }
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "items.imported", { count: clean.length });
    return { ok: true as const, added: clean.length };
  });
}

/** A new draft with the same title, department and lines. Closing date, team and suppliers are not copied. */
export async function duplicateEvent(pool: Pool, who: Who, eventId: string): Promise<Result<{ id: string }>> {
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot create events." };
  return withTenant(pool, who.tenantId, async (c) => {
    const src = (await c.query(`select title, owner_dept from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!src) return { ok: false as const, error: "Event not found." };
    const year = new Date().getUTCFullYear();
    const n = (await c.query(`insert into event_counter (tenant_id, year, last) values ($1, $2, 1) on conflict (tenant_id, year) do update set last = event_counter.last + 1 returning last`, [who.tenantId, year])).rows[0].last as number;
    const ref = `EV-${year}-${String(n).padStart(3, "0")}`;
    const title = `${String(src.title).slice(0, 190)} (copy)`;
    const id = (await c.query(`insert into sourcing_event (tenant_id, title, ref, owner_dept, created_by) values ($1,$2,$3,$4,$5) returning id`, [who.tenantId, title, ref, src.owner_dept, who.membershipId])).rows[0].id as string;
    await c.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'requester')`, [who.tenantId, id, who.membershipId]);
    await c.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type) select tenant_id, $2, line_no, description, quantity, unit, block_type from event_item where event_id = $1`, [eventId, id]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, id, "event.duplicated", { from: eventId, ref });
    return { ok: true as const, id };
  });
}

// ---------- templates ----------

export interface TemplateRow { id: string; name: string; ownerDept: string; lineCount: number; createdAt: string }
type TplItem = { description: string; quantity: string; unit: string; blockType: string };

export async function listTemplates(pool: Pool, who: Who): Promise<TemplateRow[]> {
  return withTenant(pool, who.tenantId, async (c) => (await c.query(
    `select id, name, coalesce(owner_dept,'') as owner_dept, jsonb_array_length(items)::int as n, created_at from event_template order by created_at desc limit 100`)).rows
    .map((r) => ({ id: r.id as string, name: r.name as string, ownerDept: r.owner_dept as string, lineCount: r.n as number, createdAt: new Date(r.created_at).toISOString() })));
}

/** Keeps the department and the lines of an event as a template. */
export async function saveAsTemplate(pool: Pool, who: Who, eventId: string, name: string): Promise<Result<{ id: string }>> {
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot create templates." };
  const n = (name ?? "").trim();
  if (n.length < 2 || n.length > 120) return { ok: false, error: "Give the template a name of 2 to 120 characters." };
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select owner_dept from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev) return { ok: false as const, error: "Event not found." };
    const items = (await c.query(`select description, quantity::text as quantity, unit, block_type as "blockType" from event_item where event_id = $1 order by line_no`, [eventId])).rows;
    if (!items.length) return { ok: false as const, error: "Add at least one line before saving a template." };
    const id = (await c.query(`insert into event_template (tenant_id, name, owner_dept, items, created_by) values ($1,$2,$3,$4,$5) returning id`,
      [who.tenantId, n, ev.owner_dept, JSON.stringify(items), who.membershipId])).rows[0].id as string;
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "template.saved", { name: n });
    return { ok: true as const, id };
  });
}

export async function deleteTemplate(pool: Pool, who: Who, templateId: string): Promise<Result<object>> {
  if (who.role !== "admin") return { ok: false, error: "Only an administrator can delete templates." };
  return withTenant(pool, who.tenantId, async (c) => {
    const r = await c.query(`delete from event_template where id = $1`, [templateId]);
    return r.rowCount ? { ok: true as const } : { ok: false as const, error: "Template not found." };
  });
}

/** A new draft event with the template's department and lines. */
export async function createFromTemplate(pool: Pool, who: Who, templateId: string, input: CreateInput): Promise<CreateResult> {
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot create events." };
  const v = validate(input);
  if (!v.ok) return v;
  return withTenant(pool, who.tenantId, async (c) => {
    const t = (await c.query(`select owner_dept, items from event_template where id = $1`, [templateId])).rows[0];
    if (!t) return { ok: false as const, error: "Template not found." };
    const year = new Date().getUTCFullYear();
    const n = (await c.query(`insert into event_counter (tenant_id, year, last) values ($1, $2, 1) on conflict (tenant_id, year) do update set last = event_counter.last + 1 returning last`, [who.tenantId, year])).rows[0].last as number;
    const ref = `EV-${year}-${String(n).padStart(3, "0")}`;
    const id = (await c.query(`insert into sourcing_event (tenant_id, title, ref, owner_dept, closes_at, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
      [who.tenantId, v.value.title, ref, v.value.ownerDept || t.owner_dept || null, v.value.closesAt, who.membershipId])).rows[0].id as string;
    await c.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'requester')`, [who.tenantId, id, who.membershipId]);
    let line = 0;
    for (const it of t.items as TplItem[]) {
      await c.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type) values ($1,$2,$3,$4,$5,$6,$7)`,
        [who.tenantId, id, ++line, it.description, it.quantity, it.unit, it.blockType]);
    }
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, id, "event.created", { ref, title: v.value.title, template: templateId });
    return { ok: true as const, event: map((await c.query(`${SELECT} where id = $1`, [id])).rows[0]) };
  });
}
