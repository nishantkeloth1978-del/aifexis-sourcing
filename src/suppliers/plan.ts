import type { Pool, PoolClient } from "pg";
import { audit, withTenant } from "@/authz";
import type { Who } from "@/events/service";
import { inviteLink } from "./links";
import { issueInvitation, mayInvite, type Out } from "./service";

const internal = (w: Who) => ({ kind: "internal" as const, userId: w.userId, tenantId: w.tenantId });
export interface PlannedSupplier { supplierId: string; name: string; category: string; email: string }

/** Suppliers picked on a draft event. They are invited automatically when the event is published. */
export async function listPlan(pool: Pool, who: Who, eventId: string): Promise<PlannedSupplier[]> {
  return withTenant(pool, who.tenantId, async (c) =>
    (await c.query(`select s.id, s.name, coalesce(s.category, '') as category, coalesce(s.contact_email, '') as email
                      from event_supplier_plan p join supplier_org s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
                     where p.event_id = $1 order by s.name`, [eventId])).rows.map((r) => ({ supplierId: r.id, name: r.name, category: r.category, email: r.email })));
}

async function draftGuard(c: PoolClient, who: Who, eventId: string): Promise<string | null> {
  const ev = (await c.query(`select state::text as state from sourcing_event where id = $1`, [eventId])).rows[0];
  if (!ev) return "Event not found.";
  if (!(await mayInvite(c, who, eventId))) return "Only the buyer or an administrator can choose suppliers.";
  if (ev.state !== "draft") return "Suppliers can be chosen while the event is a draft. After publication, invite them from the invitation list.";
  return null;
}

/** Adds suppliers by id and/or every active supplier in a category. Returns how many were added. */
export async function addToPlan(pool: Pool, who: Who, eventId: string, input: { supplierIds?: string[]; category?: string }): Promise<Out<{ added: number }>> {
  return withTenant(pool, who.tenantId, async (c) => {
    const bad = await draftGuard(c, who, eventId);
    if (bad) return { ok: false as const, error: bad };
    const ids = new Set<string>((input.supplierIds ?? []).filter((x) => /^[0-9a-f-]{36}$/.test(x)));
    const cat = (input.category ?? "").trim().toLowerCase();
    if (cat) for (const r of (await c.query(`select id from supplier_org where coalesce(status, 'active') = 'active' and lower(trim(coalesce(category, ''))) = $1 and exists (select 1 from supplier_user su where su.supplier_id = supplier_org.id)`, [cat])).rows) ids.add(r.id as string);
    if (!ids.size) return { ok: false as const, error: "Choose at least one supplier, or a category that has suppliers." };
    let added = 0;
    for (const id of ids) {
      const s = (await c.query(`select status, exists (select 1 from supplier_user su where su.supplier_id = supplier_org.id) as has_user from supplier_org where id = $1`, [id])).rows[0];
      if (!s || s.status === "blocked" || !s.has_user) continue;
      const r = await c.query(`insert into event_supplier_plan (tenant_id, event_id, supplier_id, added_by) values ($1,$2,$3,$4) on conflict do nothing`, [who.tenantId, eventId, id, who.membershipId]);
      added += r.rowCount ?? 0;
    }
    if (added) await audit(c, internal(who), eventId, "suppliers.planned", { added });
    return { ok: true as const, added };
  });
}

export async function removeFromPlan(pool: Pool, who: Who, eventId: string, supplierId: string): Promise<Out> {
  return withTenant(pool, who.tenantId, async (c) => {
    const bad = await draftGuard(c, who, eventId);
    if (bad) return { ok: false as const, error: bad };
    await c.query(`delete from event_supplier_plan where event_id = $1 and supplier_id = $2`, [eventId, supplierId]);
    return { ok: true as const };
  });
}

/**
 * Called inside the publication transaction. Creates the invitations for every planned supplier and queues an e-mail with the link.
 * Without APP_URL no link can be written into the e-mail; the buyer then uses "Get invitation links" on the published event.
 */
export async function inviteOnPublish(c: PoolClient, tenantId: string, eventId: string, byMembershipId: string | null): Promise<number> {
  const planned = (await c.query(`select supplier_id from event_supplier_plan where event_id = $1`, [eventId])).rows.map((r) => r.supplier_id as string);
  if (!planned.length) return 0;
  const ev = (await c.query(`select ref, title, closes_at from sourcing_event where id = $1`, [eventId])).rows[0];
  const buyerName = (await c.query(`select name from tenant where id = $1`, [tenantId])).rows[0]?.name ?? "A buyer";
  let n = 0;
  for (const sid of planned) {
    const inv = await issueInvitation(c, tenantId, eventId, sid, byMembershipId, 14 * 24, true);   // quiet: the e-mail below carries the link
    if (!inv.ok) continue;
    n++;
    const link = inviteLink(inv.token);
    if (inv.email && link) {
      const closes = ev.closes_at ? ` Bids close on ${new Date(ev.closes_at).toUTCString()}.` : "";
      await c.query(`insert into email_outbox (tenant_id, event_id, to_email, subject, body) values ($1,$2,$3,$4,$5)`,
        [tenantId, eventId, inv.email, `${buyerName}: you are invited to bid on ${ev.ref}`, `${buyerName} invites you to bid on ${ev.ref}: ${ev.title}.${closes}\n\nOpen this link to sign in, confirm that you will take part, and see the details:\n${link}\n\nThe link works for 14 days.`]);
    }
  }
  await c.query(`delete from event_supplier_plan where event_id = $1`, [eventId]);
  if (n) await audit(c, { kind: "system", tenantId }, eventId, "suppliers.invited_on_publish", { invited: n });
  return n;
}

/** For a published event: fresh links for every invited supplier, to send by hand while e-mail is not set up. Old links stop working. */
export async function freshLinks(pool: Pool, who: Who, eventId: string): Promise<Out<{ links: { supplier: string; email: string; url: string }[] }>> {
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev) return { ok: false as const, error: "Event not found." };
    if (!(await mayInvite(c, who, eventId))) return { ok: false as const, error: "Only the buyer or an administrator can do this." };
    if (ev.state !== "published") return { ok: false as const, error: "Links can be made while the event is published and open." };
    const base = inviteLink("x").replace(/x$/, "") || `${"{your site}"}/invite/`;
    const links: { supplier: string; email: string; url: string }[] = [];
    for (const r of (await c.query(`select supplier_id from invitation where event_id = $1 and accepted_at is null order by supplier_id`, [eventId])).rows) {
      const inv = await issueInvitation(c, who.tenantId, eventId, r.supplier_id, who.membershipId);
      if (inv.ok) links.push({ supplier: inv.supplierName, email: inv.email, url: `${base}${inv.token}` });
    }
    await audit(c, internal(who), eventId, "supplier.links_reissued", { count: links.length });
    return { ok: true as const, links };
  });
}
