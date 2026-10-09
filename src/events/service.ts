import { fillFromCatalog } from "@/catalog/fill";
import type { Pool } from "pg";
import { audit, withTenant } from "@/authz";
import { cleanLotName, findOrCreateLot, lotsOf, type Lot } from "@/lots/service";

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

export interface EventItem { id: string; lineNo: number; description: string; quantity: string; unit: string; blockType: string; lotId: string | null; code: string | null; specification: string | null; requiredDate: string | null; materialGroup: string | null; targetPrice: string | null }
export interface EventDetail extends EventSummary { items: EventItem[]; lots: Lot[]; stateVersion: number }
export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const mapItem = (r: Record<string, unknown>): EventItem => ({
  id: r.id as string, lineNo: r.line_no as number, description: r.description as string,
  quantity: r.quantity as string, unit: r.unit as string, blockType: r.block_type as string, lotId: (r.lot_id as string | null) ?? null, code: (r.item_code as string | null) ?? null,
  specification: (r.specification as string | null) ?? null, requiredDate: (r.required_date as string | null) ?? null, materialGroup: (r.material_group as string | null) ?? null, targetPrice: (r.target_price as string | null) ?? null,
});

export async function getEvent(pool: Pool, who: Who, id: string): Promise<EventDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withTenant(pool, who.tenantId, async (c) => {
    const e = (await c.query(`${SELECT} where id = $1`, [id])).rows[0];
    if (!e) return null;
    const v = (await c.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;
    const items = (await c.query(`select id, line_no, description, quantity::text, unit, block_type, lot_id, item_code, specification, to_char(required_date, 'YYYY-MM-DD') as required_date, material_group, target_price::text from event_item where event_id = $1 order by line_no`, [id])).rows.map(mapItem);
    return { ...map(e), items, lots: await lotsOf(c, id), stateVersion: v };
  });
}

export interface ItemInput { description: string; quantity: string; unit: string; lotId?: string | null; code?: string | null }
export const cleanItemCode = (v: unknown): string | null | false => { const c = String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase(); return !c ? null : c.length > 40 ? false : c; };
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
  const code = cleanItemCode(input.code);
  if (code === false) return { ok: false, error: "The item code is too long (40 characters at most)." };
  return withTenant(pool, who.tenantId, async (c) => {
    const err = await lockDraft(c, eventId);
    if (err) return { ok: false as const, error: err };
    const n = (await c.query(`select coalesce(max(line_no), 0) + 1 as n from event_item where event_id = $1`, [eventId])).rows[0].n as number;
    const lotId = input.lotId || null;
    if (lotId && !(await c.query(`select 1 from event_lot where event_id = $1 and id = $2`, [eventId, lotId])).rowCount) return { ok: false as const, error: "Lot not found." };
    const row = (await c.query(
      `insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, lot_id, item_code) values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, line_no, description, quantity::text, unit, block_type, lot_id, item_code, specification, to_char(required_date, 'YYYY-MM-DD') as required_date, material_group, target_price::text`,
      [who.tenantId, eventId, n, v.value.description, v.value.quantity, v.value.unit, lotId, code])).rows[0];
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

export interface ImportRow { description: string; quantity: string; unit: string; blockType: "UNIT_PRICE" | "LUMP_SUM"; lot?: string; code?: string; rowNo?: number; specification?: string; requiredDate?: string; materialGroup?: string; targetPrice?: string }
export type ImportMode = "append" | "merge" | "replace";
export const MAX_LINES = 500;

/** Adds many lines in one step, all or nothing. Every row is validated again here, whatever the browser sent. */
export async function importItems(pool: Pool, who: Who, eventId: string, rows: ImportRow[], mode: ImportMode = "append"): Promise<Result<{ added: number; updated: number; removed: number }>> {
  if (!["append", "merge", "replace"].includes(mode)) return { ok: false, error: "Choose how to import." };
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot edit events." };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "There are no lines to import." };
  if (rows.length > 200) return { ok: false, error: "Import at most 200 lines at a time." };
  const filled = await withTenant(pool, who.tenantId, (c) => fillFromCatalog(c, rows));
  const clean: ImportRow[] = [];
  for (const [i, r] of filled.rows.entries()) {
    const v = validateItem(r);
    const code = cleanItemCode(r.code);
    if (code === false) return { ok: false, error: `Row ${i + 1}: the item code is too long (40 characters at most).` };
    if (!v.ok) return { ok: false, error: `Row ${i + 1}: ${v.error}` };
    const lotRaw = String(r.lot ?? "").trim();
    const lot = lotRaw ? cleanLotName(lotRaw) ?? undefined : undefined;
    if (lotRaw && !lot) return { ok: false, error: `Row ${i + 1}: the lot name is too long (120 characters at most).` };
    const spec = String(r.specification ?? "").trim(), mg = String(r.materialGroup ?? "").trim().replace(/\s+/g, " "), rd = String(r.requiredDate ?? "").trim(), tp = String(r.targetPrice ?? "").trim();
    if (spec.length > 1000 || mg.length > 60 || (rd && (!/^\d{4}-\d{2}-\d{2}$/.test(rd) || Number.isNaN(Date.parse(rd)))) || (tp && !/^\d{1,14}(\.\d{1,4})?$/.test(tp))) return { ok: false, error: `Row ${i + 1}: the item details are not valid.` };
    clean.push({ ...v.value, blockType: r.blockType === "LUMP_SUM" ? "LUMP_SUM" : "UNIT_PRICE", lot, code: code ?? undefined, specification: spec || undefined, materialGroup: mg || undefined, requiredDate: rd || undefined, targetPrice: tp || undefined });
  }
  return withTenant(pool, who.tenantId, async (c) => {
    const err = await lockDraft(c, eventId);
    if (err) return { ok: false as const, error: err };
    let removed = 0, updated = 0, added = 0;
    if (mode === "replace") removed = (await c.query(`delete from event_item where event_id = $1`, [eventId])).rowCount ?? 0;
    const cur = (await c.query(`select coalesce(max(line_no), 0) as n, count(*)::int as cnt from event_item where event_id = $1`, [eventId])).rows[0];
    let n = cur.n as number;
    const existing = mode === "merge" ? (await c.query(`select id, item_code, lower(description) as d from event_item where event_id = $1`, [eventId])).rows : [];
    const keyOf = (code?: string | null, d?: string) => (code ? `c:${code.toUpperCase()}` : `d:${(d ?? "").toLowerCase()}`);
    const byKey = new Map<string, string>(existing.map((e) => [keyOf(e.item_code, e.d), e.id as string]));
    const inserts = clean.filter((r) => !(mode === "merge" && byKey.has(keyOf(r.code, r.description)))).length;
    if (cur.cnt + inserts > MAX_LINES) return { ok: false as const, error: `An event can have at most ${MAX_LINES} lines.` };
    for (const r of clean) {
      let lotId: string | null = null;
      if (r.lot) { const l = await findOrCreateLot(c, who.tenantId, eventId, r.lot); if (typeof l !== "string") return { ok: false as const, error: l.error }; lotId = l; }
      const hit = mode === "merge" ? byKey.get(keyOf(r.code, r.description)) : undefined;
      if (hit) {
        await c.query(`update event_item set quantity = $3, unit = $4, block_type = $5, lot_id = coalesce($6, lot_id), specification = coalesce($7, specification), required_date = coalesce($8, required_date), material_group = coalesce($9, material_group), target_price = coalesce($10, target_price) where event_id = $1 and id = $2`,
          [eventId, hit, r.quantity, r.unit.toUpperCase(), r.blockType, lotId, r.specification ?? null, r.requiredDate ?? null, r.materialGroup ?? null, r.targetPrice ?? null]);
        updated++; continue;
      }
      n += 1;
      await c.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type, lot_id, item_code, specification, required_date, material_group, target_price) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [who.tenantId, eventId, n, r.description, r.quantity, r.unit.toUpperCase(), r.blockType, lotId, r.code ?? null, r.specification ?? null, r.requiredDate ?? null, r.materialGroup ?? null, r.targetPrice ?? null]);
      added++;
    }
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "items.imported", { count: clean.length, mode, added, updated, removed });
    return { ok: true as const, added, updated, removed };
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
    await c.query(`insert into event_lot (tenant_id, event_id, lot_no, name) select tenant_id, $2, lot_no, name from event_lot where event_id = $1`, [eventId, id]);
    await c.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type, lot_id, item_code, specification, required_date, material_group, target_price)
                   select i.tenant_id, $2, i.line_no, i.description, i.quantity, i.unit, i.block_type, nl.id, i.item_code, i.specification, i.required_date, i.material_group, i.target_price
                     from event_item i
                     left join event_lot ol on ol.tenant_id = i.tenant_id and ol.id = i.lot_id
                     left join event_lot nl on nl.tenant_id = i.tenant_id and nl.event_id = $2 and nl.lot_no = ol.lot_no
                    where i.event_id = $1`, [eventId, id]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, id, "event.duplicated", { from: eventId, ref });
    return { ok: true as const, id };
  });
}

// ---------- templates ----------

export interface TemplateRow { id: string; name: string; ownerDept: string; lineCount: number; createdAt: string }
type TplItem = { description: string; quantity: string; unit: string; blockType: string; lot?: string | null; code?: string | null };

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
    const items = (await c.query(`select i.description, i.quantity::text as quantity, i.unit, i.block_type as "blockType", l.name as lot, i.item_code as code
                                    from event_item i left join event_lot l on l.tenant_id = i.tenant_id and l.id = i.lot_id where i.event_id = $1 order by i.line_no`, [eventId])).rows;
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
      let lotId: string | null = null;
      if (it.lot) { const l = await findOrCreateLot(c, who.tenantId, id, it.lot); lotId = typeof l === "string" ? l : null; }
      await c.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type, lot_id, item_code) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [who.tenantId, id, ++line, it.description, it.quantity, it.unit, it.blockType, lotId, it.code ?? null]);
    }
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, id, "event.created", { ref, title: v.value.title, template: templateId });
    return { ok: true as const, event: map((await c.query(`${SELECT} where id = $1`, [id])).rows[0]) };
  });
}

export interface ItemDetails { specification: string; requiredDate: string; materialGroup: string; targetPrice: string }
/** Optional standard details of a line. Empty values clear the field. Draft events only. */
export async function updateItemDetails(pool: Pool, who: Who, eventId: string, itemId: string, d: ItemDetails): Promise<Result<{ item: EventItem }>> {
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot edit events." };
  const spec = String(d.specification ?? "").trim(), group = String(d.materialGroup ?? "").trim().replace(/\s+/g, " "), date = String(d.requiredDate ?? "").trim(), price = String(d.targetPrice ?? "").trim();
  if (spec.length > 1000) return { ok: false, error: "The specification is too long (1,000 characters at most)." };
  if (group.length > 60) return { ok: false, error: "The material group is too long (60 characters at most)." };
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) return { ok: false, error: "Enter the required date as a valid date." };
  if (price && !/^\d{1,14}(\.\d{1,4})?$/.test(price)) return { ok: false, error: "The target price must be a positive number with up to 4 decimals." };
  return withTenant(pool, who.tenantId, async (c) => {
    const err = await lockDraft(c, eventId);
    if (err) return { ok: false as const, error: err };
    const r = await c.query(`update event_item set specification = $3, required_date = $4, material_group = $5, target_price = $6 where event_id = $1 and id = $2
      returning id, line_no, description, quantity::text, unit, block_type, lot_id, item_code, specification, to_char(required_date, 'YYYY-MM-DD') as required_date, material_group, target_price::text`,
      [eventId, itemId, spec || null, date || null, group || null, price || null]);
    if (!r.rowCount) return { ok: false as const, error: "Item not found." };
    return { ok: true as const, item: mapItem(r.rows[0]) };
  });
}

/** Deletes a draft event (hidden, not erased: the audit trail keeps it). Only an administrator or the person who created it, and only before it is submitted. */
export async function deleteDraftEvent(pool: Pool, who: Who, eventId: string): Promise<Result<object>> {
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot delete events." };
  return withTenant(pool, who.tenantId, async (c) => {
    const e = (await c.query(`select ref, state::text as state, created_by from sourcing_event where id = $1 for update`, [eventId])).rows[0];
    if (!e) return { ok: false as const, error: "Event not found." };
    if (e.state !== "draft") return { ok: false as const, error: "Only a draft can be deleted. An event that has been submitted or published cannot be removed." };
    if (who.role !== "admin" && e.created_by !== who.membershipId) return { ok: false as const, error: "Only an administrator or the person who created this event can delete it." };
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "event.deleted", { ref: e.ref });
    if (!(await c.query(`select soft_delete_draft_event($1, $2) as ok`, [eventId, who.membershipId])).rows[0].ok) return { ok: false as const, error: "Event not found." };
    return { ok: true as const };
  });
}

/** Edits the description, quantity and unit of one draft line. */
export async function updateItemCore(pool: Pool, who: Who, eventId: string, itemId: string, input: { description: string; quantity: string; unit: string }): Promise<Result<{ item: EventItem }>> {
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot edit events." };
  const v = validateItem(input);
  if (!v.ok) return v;
  return withTenant(pool, who.tenantId, async (c) => {
    const err = await lockDraft(c, eventId);
    if (err) return { ok: false as const, error: err };
    const r = await c.query(`update event_item set description = $3, quantity = $4, unit = $5 where event_id = $1 and id = $2
      returning id, line_no, description, quantity::text, unit, block_type, lot_id, item_code, specification, to_char(required_date, 'YYYY-MM-DD') as required_date, material_group, target_price::text`,
      [eventId, itemId, v.value.description, v.value.quantity, v.value.unit]);
    if (!r.rowCount) return { ok: false as const, error: "Item not found." };
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "item.edited", { itemId });
    return { ok: true as const, item: mapItem(r.rows[0]) };
  });
}

/** Deletes several draft lines at once. */
export async function deleteItems(pool: Pool, who: Who, eventId: string, itemIds: string[]): Promise<Result<{ count: number }>> {
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot edit events." };
  const ids = [...new Set(itemIds)].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return { ok: false, error: "Select at least one item." };
  return withTenant(pool, who.tenantId, async (c) => {
    const err = await lockDraft(c, eventId);
    if (err) return { ok: false as const, error: err };
    const d = await c.query(`delete from event_item where event_id = $1 and id = any($2::uuid[])`, [eventId, ids]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "item.deleted", { count: d.rowCount });
    return { ok: true as const, count: d.rowCount ?? 0 };
  });
}

export interface ActivityRow { at: string; actor: string; action: string }
/** The latest activity on an event, newest first. Actions only, never the detail payloads. */
export async function listActivity(pool: Pool, who: Who, eventId: string, limit = 30): Promise<ActivityRow[]> {
  return withTenant(pool, who.tenantId, async (c) => {
    const r = await c.query(`select at, actor, action from audit_event where event_id = $1 order by id desc limit $2`, [eventId, limit]);
    return r.rows.map((x) => ({ at: new Date(x.at).toISOString(), actor: String(x.actor ?? ""), action: String(x.action) }));
  });
}
