import type { Pool, PoolClient } from "pg";
import { audit, withTenant } from "@/authz";
import type { Who } from "@/events/service";

export interface CatalogItem { id: string; code: string; description: string; unit: string; category: string; active: boolean }
export type COut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface CatalogInput { code: string; description: string; unit: string; category?: string }

const CAN_MANAGE = new Set(["admin", "member"]);
export const MAX_CATALOG_IMPORT = 1000;
export const cleanCode = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();

const map = (r: Record<string, unknown>): CatalogItem => ({ id: r.id as string, code: r.code as string, description: r.description as string, unit: r.unit as string, category: (r.category as string | null) ?? "", active: r.active as boolean });
const COLS = `id, code, description, unit, category, active`;

export function validateCatalog(i: CatalogInput): { ok: true; value: { code: string; description: string; unit: string; category: string | null } } | { ok: false; error: string } {
  const code = cleanCode(i.code), description = String(i.description ?? "").trim(), unit = String(i.unit ?? "").trim().toUpperCase(), category = String(i.category ?? "").trim();
  if (!code || code.length > 40) return { ok: false, error: "Enter an item code of up to 40 characters." };
  if (!description) return { ok: false, error: "Enter a description." };
  if (description.length > 500) return { ok: false, error: "The description is too long (500 characters at most)." };
  if (!unit || unit.length > 20) return { ok: false, error: "Enter a unit (for example EA, M, KG, HR)." };
  if (category.length > 120) return { ok: false, error: "The category is too long (120 characters at most)." };
  return { ok: true, value: { code, description, unit, category: category || null } };
}

/** Everyone in the tenant can read the catalogue (it feeds the item pickers); `q` filters by code, description or category. */
export async function listCatalog(pool: Pool, who: Who, opts: { q?: string; activeOnly?: boolean; limit?: number } = {}): Promise<CatalogItem[]> {
  const q = (opts.q ?? "").trim().toLowerCase();
  return withTenant(pool, who.tenantId, async (c) =>
    (await c.query(`select ${COLS} from catalog_item
                     where ($1 = '' or lower(code) like '%' || $1 || '%' or lower(description) like '%' || $1 || '%' or lower(coalesce(category, '')) like '%' || $1 || '%')
                       and (not $2 or active) order by code limit $3`, [q.replace(/[%_\\]/g, ""), Boolean(opts.activeOnly), Math.min(opts.limit ?? 500, 2000)])).rows.map(map));
}

export async function addCatalogItem(pool: Pool, who: Who, input: CatalogInput): Promise<COut<{ item: CatalogItem }>> {
  if (!CAN_MANAGE.has(who.role)) return { ok: false, error: "Your role cannot change the item catalogue." };
  const v = validateCatalog(input); if (!v.ok) return v;
  return withTenant(pool, who.tenantId, async (c) => {
    if ((await c.query(`select 1 from catalog_item where upper(code) = $1`, [v.value.code])).rowCount) return { ok: false as const, error: "An item with that code already exists." };
    const r = (await c.query(`insert into catalog_item (tenant_id, code, description, unit, category) values ($1,$2,$3,$4,$5) returning ${COLS}`, [who.tenantId, v.value.code, v.value.description, v.value.unit, v.value.category])).rows[0];
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "catalog.added", { code: v.value.code });
    return { ok: true as const, item: map(r) };
  });
}

export async function updateCatalogItem(pool: Pool, who: Who, id: string, input: CatalogInput & { active?: boolean }): Promise<COut<{ item: CatalogItem }>> {
  if (!CAN_MANAGE.has(who.role)) return { ok: false, error: "Your role cannot change the item catalogue." };
  const v = validateCatalog(input); if (!v.ok) return v;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Item not found." };
  return withTenant(pool, who.tenantId, async (c) => {
    if ((await c.query(`select 1 from catalog_item where upper(code) = $1 and id <> $2`, [v.value.code, id])).rowCount) return { ok: false as const, error: "An item with that code already exists." };
    const r = (await c.query(`update catalog_item set code = $2, description = $3, unit = $4, category = $5, active = coalesce($6, active), updated_at = now() where id = $1 returning ${COLS}`,
      [id, v.value.code, v.value.description, v.value.unit, v.value.category, input.active ?? null])).rows[0];
    if (!r) return { ok: false as const, error: "Item not found." };
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "catalog.updated", { code: v.value.code, active: r.active });
    return { ok: true as const, item: map(r) };
  });
}

export interface CatalogImportRow extends CatalogInput { }
/** Adds new codes and updates existing ones (matched by code). All or nothing. */
export async function importCatalog(pool: Pool, who: Who, rows: CatalogImportRow[]): Promise<COut<{ added: number; updated: number }>> {
  if (!CAN_MANAGE.has(who.role)) return { ok: false, error: "Your role cannot change the item catalogue." };
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: "There are no items to import." };
  if (rows.length > MAX_CATALOG_IMPORT) return { ok: false, error: "Import at most 1,000 items at a time." };
  const clean: { code: string; description: string; unit: string; category: string | null }[] = [], seen = new Set<string>();
  for (const [i, r] of rows.entries()) {
    const v = validateCatalog(r);
    if (!v.ok) return { ok: false, error: `Row ${i + 1}: ${v.error}` };
    if (seen.has(v.value.code)) return { ok: false, error: `Row ${i + 1}: the code ${v.value.code} appears twice in the file.` };
    seen.add(v.value.code); clean.push(v.value);
  }
  return withTenant(pool, who.tenantId, async (c) => {
    let added = 0, updated = 0;
    for (const r of clean) {
      const x = await c.query(`insert into catalog_item (tenant_id, code, description, unit, category) values ($1,$2,$3,$4,$5)
                               on conflict (tenant_id, upper(code)) do update set description = excluded.description, unit = excluded.unit, category = excluded.category, active = true, updated_at = now()
                               returning (xmax = 0) as inserted`, [who.tenantId, r.code, r.description, r.unit, r.category]);
      if (x.rows[0].inserted) added++; else updated++;
    }
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "catalog.imported", { added, updated });
    return { ok: true as const, added, updated };
  });
}

/** Looks up active catalogue entries by code, for filling event lines. */
export async function catalogByCodes(c: PoolClient, codes: string[]): Promise<Map<string, CatalogItem>> {
  const list = [...new Set(codes.map(cleanCode).filter(Boolean))];
  if (!list.length) return new Map();
  const rows = (await c.query(`select ${COLS} from catalog_item where upper(code) = any($1) and active`, [list])).rows.map(map);
  return new Map(rows.map((r) => [r.code.toUpperCase(), r]));
}
