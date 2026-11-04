import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { audit, withTenant } from "@/authz";
import { can } from "@/access/permissions";
import type { Who } from "@/events/service";
import { appBase } from "./links";
import { createSupplier, type Out } from "./service";

const internal = (w: Who) => ({ kind: "internal" as const, userId: w.userId, tenantId: w.tenantId });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Registration { enabled: boolean; url: string; key: string }
export interface Application { id: string; company: string; contactName: string; contactEmail: string; country: string; category: string; phone: string; taxNo: string; notes: string; state: "pending" | "approved" | "rejected"; decisionNote: string; createdAt: string }

/** The company's public registration link, or null when it has never been switched on. */
export async function getRegistration(pool: Pool, who: Who): Promise<Registration | null> {
  if (!can(who, "supplier.manage")) return null;
  const r = (await withTenant(pool, who.tenantId, (c) => c.query(`select reg_key, enabled from vendor_registration`))).rows[0];
  return r ? { key: r.reg_key, enabled: r.enabled, url: `${appBase() || ""}/vendors/register/${r.reg_key}` } : null;
}

export async function setRegistration(pool: Pool, who: Who, enabled: boolean, renew = false): Promise<Out<{ registration: Registration }>> {
  if (!can(who, "supplier.manage")) return { ok: false, error: "Your role cannot manage suppliers." };
  await withTenant(pool, who.tenantId, async (c) => {
    const key = randomBytes(16).toString("hex");
    await c.query(`insert into vendor_registration (tenant_id, reg_key, enabled) values ($1,$2,$3)
                   on conflict (tenant_id) do update set enabled = $3, reg_key = case when $4 then excluded.reg_key else vendor_registration.reg_key end`, [who.tenantId, key, enabled, renew]);
    await audit(c, internal(who), null, enabled ? "vendor_registration.enabled" : "vendor_registration.disabled", { renewed: renew });
  });
  return { ok: true, registration: (await getRegistration(pool, who))! };
}

export async function listApplications(pool: Pool, who: Who): Promise<Application[]> {
  if (!can(who, "supplier.manage")) return [];
  return withTenant(pool, who.tenantId, async (c) => (await c.query(`select * from supplier_application order by (state = 'pending') desc, created_at desc limit 200`)).rows.map((r) => ({
    id: r.id, company: r.company, contactName: r.contact_name, contactEmail: r.contact_email, country: r.country, category: r.category, phone: r.phone, taxNo: r.tax_no, notes: r.notes,
    state: r.state, decisionNote: r.decision_note, createdAt: new Date(r.created_at).toISOString() })));
}

/** Approve creates the supplier (with its profile) so it can be picked for events; reject records the reason. The applicant is e-mailed either way. */
export async function decideApplication(pool: Pool, who: Who, id: string, approve: boolean, note?: string): Promise<Out> {
  if (!can(who, "supplier.manage")) return { ok: false, error: "Your role cannot manage suppliers." };
  const why = (note ?? "").trim().slice(0, 500);
  if (!approve && why.length < 3) return { ok: false, error: "Give a short reason for rejecting (at least 3 characters)." };
  const app = (await withTenant(pool, who.tenantId, (c) => c.query(`select * from supplier_application where id = $1 and state = 'pending'`, [id]))).rows[0];
  if (!app) return { ok: false, error: "That application was already decided." };
  let supplierId: string | null = null;
  if (approve) {
    const made = await createSupplier(pool, who, { name: app.company, contactName: app.contact_name, contactEmail: app.contact_email });
    if (!made.ok) return made;
    supplierId = made.supplier.id;
  }
  return withTenant(pool, who.tenantId, async (c) => {
    if (supplierId) await c.query(`update supplier_org set category = nullif($2, ''), country = nullif($3, ''), phone = nullif($4, ''), tax_no = nullif($5, ''), notes = nullif($6, '') where id = $1`, [supplierId, app.category, app.country, app.phone, app.tax_no, app.notes]);
    const r = await c.query(`update supplier_application set state = $2, decision_note = $3, supplier_id = $4, decided_by = $5, decided_at = now() where id = $1 and state = 'pending'`, [id, approve ? "approved" : "rejected", approve ? "" : why, supplierId, who.membershipId]);
    if (!r.rowCount) return { ok: false as const, error: "That application was already decided." };
    const company = (await c.query(`select name from tenant where id = $1`, [who.tenantId])).rows[0]?.name ?? "The buyer";
    await c.query(`insert into email_outbox (tenant_id, event_id, to_email, subject, body) values ($1,null,$2,$3,$4)`, [who.tenantId, app.contact_email,
      approve ? `${company}: your supplier registration is approved` : `${company}: your supplier registration`,
      approve ? `${company} approved the registration of ${app.company}. You will receive an invitation by e-mail when you are invited to a tender.` : `${company} could not approve the registration of ${app.company}. Reason: ${why}`]);
    await audit(c, internal(who), null, approve ? "vendor_application.approved" : "vendor_application.rejected", { company: app.company });
    return { ok: true as const };
  });
}

// ---------- public side (no login) ----------
export async function vendorRegInfo(pool: Pool, key: string): Promise<{ tenantName: string } | null> {
  if (!/^[a-f0-9]{32}$/.test(key)) return null;
  const r = (await pool.query(`select * from vendor_reg_info($1)`, [key])).rows[0];
  return r ? { tenantName: r.tenant_name as string } : null;
}

export interface ApplicationInput { company: string; contactName: string; contactEmail: string; country: string; category: string; phone: string; taxNo: string; notes: string }
const MESSAGES: Record<string, string> = {
  closed: "This registration link is not valid or has been switched off.",
  exists: "A supplier with this company name or contact email is already registered.",
  staff: "That email address belongs to a member of this organisation. Use a company contact email.",
  pending: "An application for this email address is already waiting for approval.",
  busy: "Too many applications right now. Try again later.",
};
export async function submitApplication(pool: Pool, key: string, input: ApplicationInput): Promise<Out> {
  if (!/^[a-f0-9]{32}$/.test(key)) return { ok: false, error: MESSAGES.closed! };
  const company = (input.company ?? "").trim(), email = (input.contactEmail ?? "").trim().toLowerCase();
  if (company.length < 2 || company.length > 200) return { ok: false, error: "Enter the company name (2 to 200 characters)." };
  if (!EMAIL.test(email) || email.length > 200) return { ok: false, error: "Enter a valid contact email." };
  if ((input.contactName ?? "").trim().length < 2) return { ok: false, error: "Enter the contact person's name." };
  const r = (await pool.query(`select vendor_reg_submit($1,$2,$3,$4,$5,$6,$7,$8,$9) as result`, [key, company, input.contactName, email, input.country, input.category, input.phone, input.taxNo, input.notes])).rows[0]?.result as string;
  return r === "ok" ? { ok: true } : { ok: false, error: MESSAGES[r] ?? MESSAGES.closed! };
}
