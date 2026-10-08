import type { Pool } from "pg";
import { audit, withTenant } from "@/authz";
import type { Who } from "@/events/service";
import { mapSupplier, SUPPLIER_COLS, type Out, type Supplier, type SupplierProfileFields } from "./service";

const CAN_MANAGE = new Set(["admin", "member"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_SUPPLIER_IMPORT = 500;

export interface ProfileInput extends Partial<SupplierProfileFields> { name: string; contactName?: string; contactEmail: string }
type Clean = { name: string; contactName: string | null; contactEmail: string; vendorCode: string | null; country: string | null; category: string | null; phone: string | null; taxNo: string | null; notes: string | null };

export function validateProfile(i: ProfileInput): { ok: true; value: Clean } | { ok: false; error: string } {
  const t = (v: unknown) => String(v ?? "").trim();
  const name = t(i.name), email = t(i.contactEmail).toLowerCase();
  if (name.length < 2 || name.length > 200) return { ok: false, error: "Enter the supplier's name (2 to 200 characters)." };
  if (!EMAIL.test(email) || email.length > 200) return { ok: false, error: "Enter a valid contact email." };
  const lim = (v: unknown, n: number) => { const x = t(v); return x.length > n ? null : x || ""; };
  const vendorCode = lim(i.vendorCode, 40), country = lim(i.country, 80), category = lim(i.category, 120), phone = lim(i.phone, 40), taxNo = lim(i.taxNo, 60), notes = lim(i.notes, 1000), contactName = lim(i.contactName, 100);
  if ([vendorCode, country, category, phone, taxNo, notes, contactName].some((x) => x === null)) return { ok: false, error: "One of the fields is too long." };
  return { ok: true, value: { name, contactEmail: email, contactName: contactName || null, vendorCode: vendorCode || null, country: country || null, category: category || null, phone: phone || null, taxNo: taxNo || null, notes: notes || null } };
}

/** Edits the profile. The contact email cannot be changed here: invitations are tied to it. */
export async function updateSupplier(pool: Pool, who: Who, id: string, input: Omit<ProfileInput, "contactEmail">): Promise<Out<{ supplier: Supplier }>> {
  if (!CAN_MANAGE.has(who.role)) return { ok: false, error: "Your role cannot change suppliers." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Supplier not found." };
  return withTenant(pool, who.tenantId, async (c) => {
    const cur = (await c.query(`select contact_email from supplier_org where id = $1`, [id])).rows[0];
    if (!cur) return { ok: false as const, error: "Supplier not found." };
    const v = validateProfile({ ...input, contactEmail: cur.contact_email ?? "x@x.xx" });
    if (!v.ok) return v;
    const x = v.value;
    if ((await c.query(`select 1 from supplier_org where lower(name) = lower($1) and id <> $2`, [x.name, id])).rowCount) return { ok: false as const, error: "A supplier with that name already exists." };
    if (x.vendorCode && (await c.query(`select 1 from supplier_org where lower(vendor_code) = lower($1) and id <> $2`, [x.vendorCode, id])).rowCount) return { ok: false as const, error: "Another supplier already has that vendor code." };
    const r = (await c.query(`update supplier_org set name=$2, contact_name=$3, vendor_code=$4, country=$5, category=$6, phone=$7, tax_no=$8, notes=$9, updated_at=now() where id=$1 returning ${SUPPLIER_COLS}`,
      [id, x.name, x.contactName, x.vendorCode, x.country, x.category, x.phone, x.taxNo, x.notes])).rows[0];
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "supplier.updated", { supplierId: id });
    return { ok: true as const, supplier: mapSupplier(r) };
  });
}

/** Blocking stops new invitations. Existing invitations and past bids are untouched. */
export async function setSupplierStatus(pool: Pool, who: Who, id: string, status: "active" | "blocked"): Promise<Out<{ status: string }>> {
  if (!CAN_MANAGE.has(who.role)) return { ok: false, error: "Your role cannot change suppliers." };
  if (status !== "active" && status !== "blocked") return { ok: false, error: "That status is not valid." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Supplier not found." };
  return withTenant(pool, who.tenantId, async (c) => {
    const r = await c.query(`update supplier_org set status = $2, updated_at = now() where id = $1`, [id, status]);
    if (!r.rowCount) return { ok: false as const, error: "Supplier not found." };
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, status === "blocked" ? "supplier.blocked" : "supplier.unblocked", { supplierId: id });
    return { ok: true as const, status };
  });
}

export interface SupplierHistoryRow { eventId: string; ref: string; title: string; state: string; invited: string; bid: boolean; outcome: "won" | "lost" | null }
export interface SupplierProfile { supplier: Supplier; history: SupplierHistoryRow[]; wins: number; bids: number }

/** The profile with the events the supplier was invited to. Outcomes follow the current recommendation, only once the event is awarded. */
export async function supplierProfile(pool: Pool, who: Who, id: string): Promise<SupplierProfile | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withTenant(pool, who.tenantId, async (c) => {
    const s = (await c.query(`select ${SUPPLIER_COLS} from supplier_org where id = $1`, [id])).rows[0];
    if (!s) return null;
    const rows = (await c.query(
      `select e.id, e.ref, e.title, e.state::text as state, i.created_at,
              exists (select 1 from bid_revision b where b.event_id = e.id and b.supplier_id = i.supplier_id) as bid,
              exists (select 1 from recommendation r where r.event_id = e.id and r.supplier_id = i.supplier_id
                        and r.created_at = (select max(created_at) from recommendation where event_id = e.id)) as rec
         from invitation i join sourcing_event e on e.tenant_id = i.tenant_id and e.id = i.event_id
        where i.supplier_id = $1 order by i.created_at desc limit 100`, [id])).rows;
    const history: SupplierHistoryRow[] = rows.map((r) => ({
      eventId: r.id, ref: r.ref, title: r.title, state: r.state, invited: new Date(r.created_at).toISOString(), bid: r.bid,
      outcome: r.state === "awarded" && r.bid ? (r.rec ? "won" : "lost") : null,
    }));
    return { supplier: mapSupplier(s), history, wins: history.filter((h) => h.outcome === "won").length, bids: history.filter((h) => h.bid).length };
  });
}

export interface SupplierImportRow extends Omit<ProfileInput, "name"> { name: string }
/** Creates many suppliers; rows whose name or email already exist are skipped and reported. */
export async function importSuppliers(pool: Pool, who: Who, rows: SupplierImportRow[]): Promise<Out<{ added: number; skipped: { row: number; reason: string }[] }>> {
  if (!CAN_MANAGE.has(who.role)) return { ok: false, error: "Your role cannot add suppliers." };
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: "There are no suppliers to import." };
  if (rows.length > MAX_SUPPLIER_IMPORT) return { ok: false, error: "Import at most 500 suppliers at a time." };
  const clean: Clean[] = [];
  for (const [i, r] of rows.entries()) { const v = validateProfile(r); if (!v.ok) return { ok: false, error: `Row ${i + 1}: ${v.error}` }; clean.push(v.value); }
  return withTenant(pool, who.tenantId, async (c) => {
    let added = 0; const skipped: { row: number; reason: string }[] = [];
    const names = new Set<string>(), codes = new Set<string>();
    for (const [i, x] of clean.entries()) {
      const row = i + 1;
      if (names.has(x.name.toLowerCase())) { skipped.push({ row, reason: "Duplicate name in the file." }); continue; }
      if (x.vendorCode && codes.has(x.vendorCode.toLowerCase())) { skipped.push({ row, reason: "Duplicate vendor code in the file." }); continue; }
      if ((await c.query(`select 1 from supplier_org where lower(name) = lower($1)`, [x.name])).rowCount) { skipped.push({ row, reason: "A supplier with that name already exists." }); continue; }
      if (x.vendorCode && (await c.query(`select 1 from supplier_org where lower(vendor_code) = lower($1)`, [x.vendorCode])).rowCount) { skipped.push({ row, reason: "Another supplier already has that vendor code." }); continue; }
      const u = (await c.query(`select a.id, exists (select 1 from membership m where m.user_id = a.id) as staff from app_user a where lower(a.email) = $1`, [x.contactEmail])).rows[0];
      if (u?.staff) { skipped.push({ row, reason: "That email belongs to a member of your own organisation." }); continue; }
      const userId: string = u?.id ?? (await c.query(`insert into app_user (email) values ($1) returning id`, [x.contactEmail])).rows[0].id;
      const s = (await c.query(`insert into supplier_org (tenant_id, name, contact_name, contact_email, vendor_code, country, category, phone, tax_no, notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [who.tenantId, x.name, x.contactName, x.contactEmail, x.vendorCode, x.country, x.category, x.phone, x.taxNo, x.notes])).rows[0];
      await c.query(`insert into supplier_user (tenant_id, supplier_id, user_id) values ($1,$2,$3)`, [who.tenantId, s.id, userId]);
      names.add(x.name.toLowerCase()); if (x.vendorCode) codes.add(x.vendorCode.toLowerCase());
      added++;
    }
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "suppliers.imported", { added, skipped: skipped.length });
    return { ok: true as const, added, skipped };
  });
}
