import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { audit, withTenant } from "@/authz";
import type { Who } from "@/events/service";
import { notify } from "@/notifications/hooks";
import { can } from "@/access/permissions";

export interface SupplierProfileFields { vendorCode: string; country: string; category: string; phone: string; taxNo: string; notes: string }
export interface Supplier extends SupplierProfileFields { id: string; name: string; contactName: string; contactEmail: string; status: "active" | "blocked" }
export const mapSupplier = (r: Record<string, unknown>): Supplier => ({
  id: r.id as string, name: r.name as string, contactName: (r.contact_name as string) ?? "", contactEmail: (r.contact_email as string) ?? "",
  vendorCode: (r.vendor_code as string) ?? "", country: (r.country as string) ?? "", category: (r.category as string) ?? "", phone: (r.phone as string) ?? "",
  taxNo: (r.tax_no as string) ?? "", notes: (r.notes as string) ?? "", status: r.status === "blocked" ? "blocked" : "active",
});
export const SUPPLIER_COLS = `id, name, contact_name, contact_email, vendor_code, country, category, phone, tax_no, notes, status`;
export interface InvitationRow { supplierId: string; supplierName: string; contactEmail: string; status: "Invited" | "Accepted" | "Expired"; expiresAt: string; response: "accepted" | "declined" | null; declineReason: string }
export type Out<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const internal = (w: Who) => ({ kind: "internal" as const, userId: w.userId, tenantId: w.tenantId });

export async function listSuppliers(pool: Pool, who: Who): Promise<Supplier[]> {
  return withTenant(pool, who.tenantId, async (c) => (await c.query(`select ${SUPPLIER_COLS} from supplier_org order by name`)).rows.map(mapSupplier));
}

export async function createSupplier(pool: Pool, who: Who, input: { name: string; contactName?: string; contactEmail: string }): Promise<Out<{ supplier: Supplier }>> {
  if (!can(who, "supplier.manage")) return { ok: false, error: "Your role cannot add suppliers." };
  const name = (input.name ?? "").trim(), contactName = (input.contactName ?? "").trim().slice(0, 100), email = (input.contactEmail ?? "").trim().toLowerCase();
  if (name.length < 2 || name.length > 200) return { ok: false, error: "Enter the supplier's name (2 to 200 characters)." };
  if (!EMAIL.test(email) || email.length > 200) return { ok: false, error: "Enter a valid contact email." };
  return withTenant(pool, who.tenantId, async (c) => {
    if ((await c.query(`select 1 from supplier_org where lower(name) = lower($1)`, [name])).rowCount) return { ok: false as const, error: "A supplier with that name already exists." };
    // An email that belongs to one of our own staff cannot be a supplier contact (keeps buyers and bidders apart).
    const existing = (await c.query(`select a.id, exists (select 1 from membership m where m.user_id = a.id) as staff from app_user a where lower(a.email) = $1`, [email])).rows[0];
    if (existing?.staff) return { ok: false as const, error: "That email belongs to a member of your own organisation." };
    const userId: string = existing?.id ?? (await c.query(`insert into app_user (email) values ($1) returning id`, [email])).rows[0].id;
    const s = (await c.query(`insert into supplier_org (tenant_id, name, contact_name, contact_email) values ($1, $2, $3, $4) returning id`, [who.tenantId, name, contactName || null, email])).rows[0];
    await c.query(`insert into supplier_user (tenant_id, supplier_id, user_id) values ($1, $2, $3)`, [who.tenantId, s.id, userId]);
    await audit(c, internal(who), null, "supplier.created", { name });
    return { ok: true as const, supplier: mapSupplier({ id: s.id, name, contact_name: contactName, contact_email: email, status: "active" }) };
  });
}

export async function mayInvite(c: import("pg").PoolClient, who: Who, eventId: string): Promise<boolean> {
  if (can(who, "event.invite_any")) return true;
  return Boolean((await c.query(`select 1 from event_member where event_id = $1 and membership_id = $2 and event_role = 'buyer'`, [eventId, who.membershipId])).rowCount);
}

/** The invitation itself: creates or replaces it and returns the link token ONCE (only its hash is stored). No state or role checks: callers do those. */
export async function issueInvitation(c: import("pg").PoolClient, tenantId: string, eventId: string, supplierId: string, createdBy: string | null, hours = 14 * 24, quiet = false): Promise<Out<{ token: string; expiresAt: string; supplierName: string; email: string }>> {
  const so = (await c.query(`select name, status, contact_email from supplier_org where id = $1`, [supplierId])).rows[0];
  if (!so) return { ok: false, error: "Supplier not found." };
  if (so.status === "blocked") return { ok: false, error: "This supplier is blocked and cannot be invited." };
  const su = (await c.query(`select su.id, su.user_id, a.email from supplier_user su join app_user a on a.id = su.user_id where su.supplier_id = $1 order by su.id limit 1`, [supplierId])).rows[0];
  if (!su) return { ok: false, error: "This supplier has no user to invite." };
  const token = randomBytes(32).toString("base64url");
  const row = (await c.query(
    `insert into invitation (tenant_id, event_id, supplier_id, supplier_user_id, token_hash, created_by, expires_at)
     values ($1, $2, $3, $4, $5, $6, now() + ($7 || ' hours')::interval)
     on conflict (tenant_id, event_id, supplier_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at, created_by = excluded.created_by
     returning expires_at`, [tenantId, eventId, supplierId, su.id, hashToken(token), createdBy, String(hours)])).rows[0];
  const ref = (await c.query(`select ref from sourcing_event where id = $1`, [eventId])).rows[0]?.ref ?? "an event";
  if (!quiet) await notify(c, tenantId, [su.user_id], eventId, "invited", `You are invited to bid on ${ref}.`);
  return { ok: true, token, expiresAt: new Date(row.expires_at).toISOString(), supplierName: so.name, email: so.contact_email || su.email };
}

export async function inviteSupplier(pool: Pool, who: Who, eventId: string, supplierId: string): Promise<Out<{ token: string; expiresAt: string }>> {
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev) return { ok: false as const, error: "Event not found." };
    if (!(await mayInvite(c, who, eventId))) return { ok: false as const, error: "Only the buyer or an administrator can invite suppliers." };
    if (ev.state !== "published") return { ok: false as const, error: "Suppliers can be invited once the event is published and open." };
    const r = await issueInvitation(c, who.tenantId, eventId, supplierId, who.membershipId);
    if (!r.ok) return r;
    await audit(c, internal(who), eventId, "supplier.invited", { supplierId });
    return { ok: true as const, token: r.token, expiresAt: r.expiresAt };
  });
}

export async function listInvitations(pool: Pool, who: Who, eventId: string): Promise<InvitationRow[]> {
  return withTenant(pool, who.tenantId, async (c) =>
    (await c.query(`select i.supplier_id, s.name, coalesce(s.contact_email, '') as email, i.accepted_at, i.expires_at, i.response, coalesce(i.decline_reason, '') as decline_reason
                      from invitation i join supplier_org s on s.tenant_id = i.tenant_id and s.id = i.supplier_id
                     where i.event_id = $1 order by s.name`, [eventId])).rows.map((r) => ({
      supplierId: r.supplier_id, supplierName: r.name, contactEmail: r.email, expiresAt: new Date(r.expires_at).toISOString(),
      status: r.accepted_at ? "Accepted" as const : new Date(r.expires_at) <= new Date() ? "Expired" as const : "Invited" as const,
      response: (r.response as "accepted" | "declined" | null) ?? null, declineReason: r.decline_reason as string,
    })));
}

// ---------- supplier side ----------
export interface SupplierWho { tenantId: string; supplierId: string; supplierUserId: string; supplierName: string; tenantName: string; email: string }
export interface InvitedEvent { id: string; ref: string; title: string; closesAt: string | null; state: string; buyer: string; outcome: "won" | "lost" | null; revisionNo: number; submittedAt: string | null }

/** Events this supplier was invited to. Another supplier's invitations never appear. */
export async function listInvitedEvents(pool: Pool, who: SupplierWho): Promise<InvitedEvent[]> {
  return withTenant(pool, who.tenantId, async (c) =>
    (await c.query(`select e.id, e.ref, e.title, e.closes_at, e.state::text as state,
                           supplier_outcome(e.id, i.supplier_id) as outcome,
                           (select max(b.revision_no) from bid_revision b where b.tenant_id = e.tenant_id and b.event_id = e.id and b.supplier_id = i.supplier_id) as rev,
                           (select max(b.submitted_at) from bid_revision b where b.tenant_id = e.tenant_id and b.event_id = e.id and b.supplier_id = i.supplier_id) as sub_at
                      from invitation i join sourcing_event e on e.tenant_id = i.tenant_id and e.id = i.event_id
                     where i.supplier_id = $1 and e.state in ('published', 'closed', 'technical_evaluation', 'technical_approved', 'commercial_evaluation', 'recommended', 'pending_award', 'awarded', 'cancelled')
                     order by e.closes_at nulls last`, [who.supplierId])).rows.map((r) => ({
      id: r.id, ref: r.ref, title: r.title, closesAt: r.closes_at ? new Date(r.closes_at).toISOString() : null, state: r.state, buyer: who.tenantName, outcome: r.outcome ?? null,
      revisionNo: Number(r.rev ?? 0), submittedAt: r.sub_at ? new Date(r.sub_at).toISOString() : null,
    })));
}

export async function invitationInfo(pool: Pool, token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const r = (await pool.query(`select * from invitation_info($1)`, [hashToken(token)])).rows[0];
  return r ? { tenantName: r.tenant_name as string, supplierName: r.supplier_name as string, contactEmail: r.contact_email as string, eventRef: r.event_ref as string, eventTitle: r.event_title as string, expired: r.expired as boolean, accepted: r.accepted as boolean } : null;
}

export async function acceptInvitation(pool: Pool, token: string, authUserId: string, email: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return false;
  return Boolean((await pool.query(`select * from accept_invitation($1, $2, $3)`, [hashToken(token), authUserId, email])).rowCount);
}

export async function resolveSupplierLogin(pool: Pool, authUserId: string): Promise<SupplierWho | null> {
  const r = (await pool.query(`select * from resolve_supplier_login($1)`, [authUserId])).rows[0];
  return r ? { tenantId: r.tenant_id, tenantName: r.tenant_name, supplierId: r.supplier_id, supplierName: r.supplier_name, supplierUserId: r.supplier_user_id, email: r.email } : null;
}

/** Where an invited event stands for this supplier. */
export type Lane = "todo" | "submitted" | "evaluation" | "results";
export function laneOf(e: Pick<InvitedEvent, "state" | "revisionNo">): Lane {
  if (e.state === "published") return e.revisionNo > 0 ? "submitted" : "todo";
  if (e.state === "awarded" || e.state === "cancelled") return "results";
  return "evaluation";
}


export type Participation = "accepted" | "declined" | null;
export async function participationOf(pool: Pool, who: SupplierWho, eventId: string): Promise<Participation> {
  return withTenant(pool, who.tenantId, async (c) => ((await c.query(`select response from invitation where event_id = $1 and supplier_id = $2`, [eventId, who.supplierId])).rows[0]?.response as Participation) ?? null);
}

/** The supplier confirms or declines taking part. Declining needs a short reason and stops bidding; the buyer is told either way. */
export async function respondToInvitation(pool: Pool, who: SupplierWho, eventId: string, response: string, reason?: string): Promise<Out> {
  if (response !== "accepted" && response !== "declined") return { ok: false, error: "Choose accept or decline." };
  const why = (reason ?? "").trim().slice(0, 500);
  if (response === "declined" && why.length < 3) return { ok: false, error: "Give a short reason for declining (at least 3 characters)." };
  return withTenant(pool, who.tenantId, async (c) => {
    const e = (await c.query(`select ref, state::text as state, closes_at from sourcing_event where id = $1`, [eventId])).rows[0];
    const inv = (await c.query(`select 1 from invitation where event_id = $1 and supplier_id = $2`, [eventId, who.supplierId])).rows[0];
    if (!e || !inv) return { ok: false as const, error: "Invitation not found." };
    if (e.state !== "published" || (e.closes_at && new Date(e.closes_at).getTime() <= Date.now())) return { ok: false as const, error: "This event is no longer open for a response." };
    const sub = (await c.query(`select 1 from bid_revision where event_id = $1 and supplier_id = $2 limit 1`, [eventId, who.supplierId])).rowCount;
    if (response === "declined" && sub) return { ok: false as const, error: "You have already submitted a bid. Contact the buyer to withdraw it." };
    await c.query(`update invitation set response = $3, responded_at = now(), decline_reason = $4 where event_id = $1 and supplier_id = $2`, [eventId, who.supplierId, response, response === "declined" ? why : null]);
    await audit(c, { kind: "supplier", tenantId: who.tenantId, supplierUserId: who.supplierUserId } as never, eventId, response === "accepted" ? "supplier.accepted" : "supplier.declined", { supplierId: who.supplierId, ...(response === "declined" ? { reason: why } : {}) });
    const buyers = (await c.query(`select m.user_id from event_member em join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id where em.event_id = $1 and em.event_role = 'buyer'`, [eventId])).rows.map((r) => r.user_id as string);
    await notify(c, who.tenantId, buyers, eventId, response === "accepted" ? "supplier_accepted" : "supplier_declined", response === "accepted" ? `${who.supplierName} will take part in ${e.ref}.` : `${who.supplierName} declined ${e.ref}: ${why}`);
    return { ok: true as const };
  });
}
