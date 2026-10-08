import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { audit, withTenant } from "@/authz";
import { formatDec, parseDec } from "@/engine";
import { currentAwards, latestPrices, type Award } from "@/lots/service";
import type { Who } from "@/events/service";

export type Target = "SAP" | "ARIBA";
export interface HandoverPayload {
  schema: "aifexis.award.v1"; target: Target; eventRef: string; title: string; currency: string; awardedAt: string | null;
  vendor: { name: string; contactEmail: string | null; vendorCode?: string };            // vendorCode: the supplier number in SAP or Ariba, when held
  lots?: { lotNo: number; name: string }[];                       // only when the event was split into lots
  items: { lineNo: number; lotNo?: number; materialCode?: string; description: string; quantity: string; unit: string; unitPrice: string; netAmount: string }[];
  totalNet: string; recommendation: string;
}
export interface Handover { id: number; target: Target; mode: string; status: string; reference: string | null; createdAt: string }
export interface VendorRow { supplierId: string; name: string; total: string; lots: string[]; last: Handover | null }
export interface AwardedRow { id: string; ref: string; title: string; vendor: string; total: string; currency: string; last: Handover | null; vendors: VendorRow[] }
/** One document for one winning supplier. A supplier that won several lots gets one document with all of them. */
export interface Part { supplierId: string; payload: HandoverPayload }
export type HOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const mapH = (r: Record<string, unknown>): Handover => ({ id: Number(r.id), target: r.target as Target, mode: r.mode as string, status: r.status as string, reference: (r.reference as string | null) ?? null, createdAt: new Date(r.created_at as string).toISOString() });

/** Admins and buyers of the event may hand over. Anyone else gets nothing. */
async function allowed(c: PoolClient, who: Who, eventId: string): Promise<boolean> {
  if (who.role === "admin") return true;
  return (await c.query(`select 1 from event_member where event_id = $1 and membership_id = $2 and event_role = 'buyer'`, [eventId, who.membershipId])).rowCount! > 0;
}

const sum2 = (xs: (string | null)[]) => formatDec(xs.reduce((a, x) => a + (x ? parseDec(x, 2) ?? 0n : 0n), 0n), 2, false);

/** The award as the receiving system needs it: for each winning supplier, their latest prices on the lines they won. */
export async function buildParts(c: PoolClient, eventId: string, target: Target): Promise<HOut<{ parts: Part[] }>> {
  const e = (await c.query(`select ref, title, coalesce(currency,'') as currency, state::text as state from sourcing_event where id = $1`, [eventId])).rows[0];
  if (!e) return { ok: false, error: "Event not found." };
  if (e.state !== "awarded") return { ok: false, error: "Only an awarded event can be handed over." };
  const awards = await currentAwards(c, eventId);
  if (!awards.length) return { ok: false, error: "There is no recommended supplier on this event." };
  const items = (await c.query(`select line_no, description, quantity::text as quantity, unit, lot_id, item_code from event_item where event_id = $1 order by line_no`, [eventId])).rows;
  const awardedAt = (await c.query(`select max(created_at) as at from approval where event_id = $1 and step = 'award' and decision = 'approve'`, [eventId])).rows[0]?.at as Date | null;
  const bySupplier = new Map<string, Award[]>();
  for (const a of awards) bySupplier.set(a.supplierId, [...(bySupplier.get(a.supplierId) ?? []), a]);
  const parts: Part[] = [];
  for (const [supplierId, mine] of bySupplier) {
    const bid = await latestPrices(c, eventId, supplierId) as { lines?: { lineNo: number; quantity: string; unitPrice: string; amount: string }[]; total?: string } | undefined;
    if (!bid?.lines?.length) return { ok: false, error: "The winning bid has no price lines." };
    const lotIds = new Set(mine.map((a) => a.lotId).filter(Boolean));
    const wanted = lotIds.size ? items.filter((it) => lotIds.has(it.lot_id)) : items;
    const lotNoOf = new Map(mine.filter((a) => a.lotId).map((a) => [a.lotId!, a.lotNo!]));
    const lines = wanted.map((it) => {
      const l = bid.lines!.find((x) => x.lineNo === it.line_no);
      return { lineNo: it.line_no as number, ...(it.lot_id ? { lotNo: lotNoOf.get(it.lot_id) } : {}), ...(it.item_code ? { materialCode: it.item_code as string } : {}), description: it.description as string, quantity: it.quantity as string, unit: it.unit as string, unitPrice: l?.unitPrice ?? "0", netAmount: l?.amount ?? "0.00" };
    });
    const vendorCode = (await c.query(`select vendor_code from supplier_org where id = $1`, [supplierId])).rows[0]?.vendor_code as string | null | undefined;
    const notes = [...new Set(mine.map((a) => a.note))].join("\n");
    parts.push({ supplierId, payload: { schema: "aifexis.award.v1", target, eventRef: e.ref, title: e.title, currency: e.currency, awardedAt: awardedAt ? new Date(awardedAt).toISOString() : null,
      vendor: { name: mine[0]!.supplierName, contactEmail: mine[0]!.contactEmail, ...(vendorCode ? { vendorCode } : {}) },
      ...(lotIds.size ? { lots: mine.map((a) => ({ lotNo: a.lotNo!, name: a.lotName! })) } : {}),
      items: lines, totalNet: lotIds.size ? sum2(mine.map((a) => a.total)) : bid.total ?? "0.00", recommendation: notes } });
  }
  return { ok: true, parts };
}

/** The first document only; kept for events with a single winner. */
export async function buildPayload(c: PoolClient, eventId: string, target: Target): Promise<HOut<{ payload: HandoverPayload }>> {
  const r = await buildParts(c, eventId, target);
  return r.ok ? { ok: true, payload: r.parts[0]!.payload } : r;
}

export async function listAwarded(pool: Pool, who: Who): Promise<AwardedRow[]> {
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select id, ref, title, coalesce(currency,'') as currency from sourcing_event where state = 'awarded' order by created_at desc limit 100`)).rows;
    const out: AwardedRow[] = [];
    for (const e of ev) {
      if (!(await allowed(c, who, e.id))) continue;
      const p = await buildParts(c, e.id, "SAP");
      const last = (await c.query(`select id, target, mode, status, reference, created_at from handover_log where event_id = $1 order by id desc limit 1`, [e.id])).rows[0];
      const vendors: VendorRow[] = [];
      if (p.ok) for (const part of p.parts) {
        const l = (await c.query(`select id, target, mode, status, reference, created_at from handover_log where event_id = $1 and (supplier_id = $2 or supplier_id is null) order by id desc limit 1`, [e.id, part.supplierId])).rows[0];
        vendors.push({ supplierId: part.supplierId, name: part.payload.vendor.name, total: part.payload.totalNet, lots: (part.payload.lots ?? []).map((x) => `${x.lotNo}. ${x.name}`), last: l ? mapH(l) : null });
      }
      out.push({ id: e.id, ref: e.ref, title: e.title, currency: e.currency, vendor: vendors.length ? vendors.map((v) => v.name).join(", ") : "-",
        total: vendors.length ? sum2(vendors.map((v) => v.total)) : "-", last: last ? mapH(last) : null, vendors });
    }
    return out;
  });
}

export async function previewPayload(pool: Pool, who: Who, eventId: string, target: Target, supplierId?: string): Promise<HOut<{ payload: HandoverPayload; payloads: HandoverPayload[] }>> {
  return withTenant(pool, who.tenantId, async (c) => {
    if (!(await allowed(c, who, eventId))) return { ok: false as const, error: "Only the buyer or an administrator can hand over this award." };
    const r = await buildParts(c, eventId, target);
    if (!r.ok) return r;
    const parts = supplierId ? r.parts.filter((x) => x.supplierId === supplierId) : r.parts;
    if (!parts.length) return { ok: false as const, error: "That supplier has no award on this event." };
    return { ok: true as const, payload: parts[0]!.payload, payloads: parts.map((x) => x.payload) };
  });
}

/** Mock delivery: nothing leaves the system. The reference is stable for the same event, target and supplier, so repeating it never creates a second document. */
export async function sendHandover(pool: Pool, who: Who, eventId: string, target: Target, supplierId?: string): Promise<HOut<{ reference: string; duplicate: boolean; references: { supplierId: string; reference: string; duplicate: boolean }[] }>> {
  if (target !== "SAP" && target !== "ARIBA") return { ok: false, error: "Choose SAP or Ariba." };
  return withTenant(pool, who.tenantId, async (c) => {
    if (!(await allowed(c, who, eventId))) return { ok: false as const, error: "Only the buyer or an administrator can hand over this award." };
    const built = await buildParts(c, eventId, target);
    if (!built.ok) return built;
    const parts = supplierId ? built.parts.filter((x) => x.supplierId === supplierId) : built.parts;
    if (!parts.length) return { ok: false as const, error: "That supplier has no award on this event." };
    const refs: { supplierId: string; reference: string; duplicate: boolean }[] = [];
    for (const part of parts) {
      const prior = (await c.query(`select reference from handover_log where event_id = $1 and target = $2 and status = 'sent' and (supplier_id = $3 or supplier_id is null) order by id desc limit 1`, [eventId, target, part.supplierId])).rows[0];
      if (prior) { refs.push({ supplierId: part.supplierId, reference: prior.reference as string, duplicate: true }); continue; }
      const seed = `${who.tenantId}:${eventId}:${target}${built.parts.length > 1 ? ":" + part.supplierId : ""}`;
      const digits = BigInt("0x" + createHash("sha256").update(seed).digest("hex").slice(0, 12)) % 10_000_000_000n;
      const reference = `${target === "SAP" ? "MOCK-SAP-" : "MOCK-ARB-"}${digits.toString().padStart(10, "0")}`;
      await c.query(`insert into handover_log (tenant_id, event_id, target, status, reference, payload, created_by, supplier_id) values ($1,$2,$3,'sent',$4,$5,$6,$7)`, [who.tenantId, eventId, target, reference, JSON.stringify(part.payload), who.membershipId, part.supplierId]);
      await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "handover.sent", { target, reference, mode: "mock", supplier: part.payload.vendor.name });
      refs.push({ supplierId: part.supplierId, reference, duplicate: false });
    }
    return { ok: true as const, reference: refs.map((r) => r.reference).join(", "), duplicate: refs.every((r) => r.duplicate), references: refs };
  });
}
