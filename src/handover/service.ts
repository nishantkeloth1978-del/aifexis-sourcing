import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { audit, withTenant } from "@/authz";
import type { Who } from "@/events/service";

export type Target = "SAP" | "ARIBA";
export interface HandoverPayload {
  schema: "aifexis.award.v1"; target: Target; eventRef: string; title: string; currency: string; awardedAt: string | null;
  vendor: { name: string; contactEmail: string | null };
  items: { lineNo: number; description: string; quantity: string; unit: string; unitPrice: string; netAmount: string }[];
  totalNet: string; recommendation: string;
}
export interface Handover { id: number; target: Target; mode: string; status: string; reference: string | null; createdAt: string }
export interface AwardedRow { id: string; ref: string; title: string; vendor: string; total: string; currency: string; last: Handover | null }
export type HOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const mapH = (r: Record<string, unknown>): Handover => ({ id: Number(r.id), target: r.target as Target, mode: r.mode as string, status: r.status as string, reference: (r.reference as string | null) ?? null, createdAt: new Date(r.created_at as string).toISOString() });

/** Admins and buyers of the event may hand over. Anyone else gets nothing. */
async function allowed(c: PoolClient, who: Who, eventId: string): Promise<boolean> {
  if (who.role === "admin") return true;
  return (await c.query(`select 1 from event_member where event_id = $1 and membership_id = $2 and event_role = 'buyer'`, [eventId, who.membershipId])).rowCount! > 0;
}

/** The award as the receiving system needs it: the winning supplier's latest prices on the event's lines. */
export async function buildPayload(c: PoolClient, eventId: string, target: Target): Promise<HOut<{ payload: HandoverPayload }>> {
  const e = (await c.query(`select ref, title, coalesce(currency,'') as currency, state::text as state from sourcing_event where id = $1`, [eventId])).rows[0];
  if (!e) return { ok: false, error: "Event not found." };
  if (e.state !== "awarded") return { ok: false, error: "Only an awarded event can be handed over." };
  const rec = (await c.query(`select r.note, s.id as sid, s.name, s.contact_email from recommendation r join supplier_org s on s.tenant_id = r.tenant_id and s.id = r.supplier_id where r.event_id = $1 order by r.created_at desc limit 1`, [eventId])).rows[0];
  if (!rec) return { ok: false, error: "There is no recommended supplier on this event." };
  const bid = (await c.query(`select bi.payload from bid_item bi join bid_revision br on br.tenant_id = bi.tenant_id and br.id = bi.bid_revision_id
                               where br.event_id = $1 and br.supplier_id = $2 and bi.kind = 'price_lines' order by br.revision_no desc limit 1`, [eventId, rec.sid])).rows[0]?.payload as
    { lines?: { itemId?: string; lineNo: number; quantity: string; unitPrice: string; amount: string }[]; total?: string } | undefined;
  if (!bid?.lines?.length) return { ok: false, error: "The winning bid has no price lines." };
  const items = (await c.query(`select line_no, description, quantity::text as quantity, unit from event_item where event_id = $1 order by line_no`, [eventId])).rows;
  const lines = items.map((it) => {
    const l = bid.lines!.find((x) => x.lineNo === it.line_no);
    return { lineNo: it.line_no as number, description: it.description as string, quantity: it.quantity as string, unit: it.unit as string, unitPrice: l?.unitPrice ?? "0", netAmount: l?.amount ?? "0.00" };
  });
  const awardedAt = (await c.query(`select max(created_at) as at from approval where event_id = $1 and step = 'award' and decision = 'approve'`, [eventId])).rows[0]?.at as Date | null;
  return { ok: true, payload: { schema: "aifexis.award.v1", target, eventRef: e.ref, title: e.title, currency: e.currency, awardedAt: awardedAt ? new Date(awardedAt).toISOString() : null,
    vendor: { name: rec.name, contactEmail: rec.contact_email ?? null }, items: lines, totalNet: bid.total ?? "0.00", recommendation: rec.note } };
}

export async function listAwarded(pool: Pool, who: Who): Promise<AwardedRow[]> {
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select id, ref, title, coalesce(currency,'') as currency from sourcing_event where state = 'awarded' order by created_at desc limit 100`)).rows;
    const out: AwardedRow[] = [];
    for (const e of ev) {
      if (!(await allowed(c, who, e.id))) continue;
      const p = await buildPayload(c, e.id, "SAP");
      const last = (await c.query(`select id, target, mode, status, reference, created_at from handover_log where event_id = $1 order by id desc limit 1`, [e.id])).rows[0];
      out.push({ id: e.id, ref: e.ref, title: e.title, currency: e.currency, vendor: p.ok ? p.payload.vendor.name : "-", total: p.ok ? p.payload.totalNet : "-", last: last ? mapH(last) : null });
    }
    return out;
  });
}

export async function previewPayload(pool: Pool, who: Who, eventId: string, target: Target): Promise<HOut<{ payload: HandoverPayload }>> {
  return withTenant(pool, who.tenantId, async (c) => (await allowed(c, who, eventId)) ? buildPayload(c, eventId, target) : { ok: false as const, error: "Only the buyer or an administrator can hand over this award." });
}

/** Mock delivery: nothing leaves the system. The reference is stable for the same event and target, so repeating it never creates a second document. */
export async function sendHandover(pool: Pool, who: Who, eventId: string, target: Target): Promise<HOut<{ reference: string; duplicate: boolean }>> {
  if (target !== "SAP" && target !== "ARIBA") return { ok: false, error: "Choose SAP or Ariba." };
  return withTenant(pool, who.tenantId, async (c) => {
    if (!(await allowed(c, who, eventId))) return { ok: false as const, error: "Only the buyer or an administrator can hand over this award." };
    const prior = (await c.query(`select reference from handover_log where event_id = $1 and target = $2 and status = 'sent' order by id desc limit 1`, [eventId, target])).rows[0];
    if (prior) return { ok: true as const, reference: prior.reference as string, duplicate: true };
    const p = await buildPayload(c, eventId, target);
    if (!p.ok) return p;
    const digits = BigInt("0x" + createHash("sha256").update(`${who.tenantId}:${eventId}:${target}`).digest("hex").slice(0, 12)) % 10_000_000_000n;
    const reference = `${target === "SAP" ? "MOCK-SAP-" : "MOCK-ARB-"}${digits.toString().padStart(10, "0")}`;
    await c.query(`insert into handover_log (tenant_id, event_id, target, status, reference, payload, created_by) values ($1,$2,$3,'sent',$4,$5,$6)`, [who.tenantId, eventId, target, reference, JSON.stringify(p.payload), who.membershipId]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "handover.sent", { target, reference, mode: "mock" });
    return { ok: true as const, reference, duplicate: false };
  });
}
