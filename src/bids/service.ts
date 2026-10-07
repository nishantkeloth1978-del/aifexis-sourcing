import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { readBidItems, resolvePermitted, submitBid, withTenant, type Actor } from "@/authz";
import { formatDec, parseDec, rescale } from "@/engine";
import type { SupplierWho } from "@/suppliers/service";

export interface BidLine { itemId: string; lineNo: number; description: string; quantity: string; unit: string; blockType: string; unitPrice: string; amount: string }
export interface BidForm {
  event: { id: string; ref: string; title: string; currency: string; closesAt: string | null; state: string };
  items: { id: string; lineNo: number; description: string; quantity: string; unit: string; blockType: string }[];
  open: boolean; closedReason: string | null;
  revisionNo: number;                 // 0 = nothing submitted yet
  prices: Record<string, string>;     // itemId -> price as last submitted
  technicalText: string;
  total: string | null;               // as last submitted
}
export type BidOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const actorOf = (w: SupplierWho): Actor => ({ kind: "supplier", supplierUserId: w.supplierUserId, tenantId: w.tenantId });
const REASONS: Record<string, string> = {
  NOT_FOUND: "This event is not available to you.", BAD_STATE: "This event is no longer open for bids.",
  DEADLINE_PASSED: "The closing time has passed. Bids can no longer be changed.", CONFLICT: "Another submission was saved at the same moment. Try again.",
};

/** The bid form for one invited event, with this supplier's latest submitted values (never anyone else's). */
export async function getBidForm(pool: Pool, who: SupplierWho, eventId: string): Promise<BidForm | null> {
  return withTenant(pool, who.tenantId, async (c) => {
    const actor = actorOf(who);
    const r = await resolvePermitted(c, actor, eventId);
    if (!r.ok) return null;
    const e = r.event;
    const ev = (await c.query(`select ref, title, currency from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev) return null;
    const items = (await c.query(`select id, line_no, description, quantity::text as quantity, unit, block_type from event_item where event_id = $1 order by line_no`, [eventId])).rows
      .map((x) => ({ id: x.id as string, lineNo: x.line_no as number, description: x.description as string, quantity: x.quantity as string, unit: x.unit as string, blockType: x.block_type as string }));
    const mine = (await readBidItems(c, actor, eventId)).filter((b) => b.supplierId === who.supplierId);
    const lines = mine.find((b) => b.kind === "price_lines")?.payload as { lines?: { itemId: string; unitPrice: string }[]; total?: string } | undefined;
    const tech = mine.find((b) => b.kind === "technical_response")?.payload as { text?: string } | undefined;
    const closed = e.closesAt && e.closesAt.getTime() <= Date.now();
    const open = e.state === "published" && !closed;
    return {
      event: { id: eventId, ref: ev.ref, title: ev.title, currency: ev.currency ?? "", closesAt: e.closesAt ? e.closesAt.toISOString() : null, state: e.state },
      items, open,
      closedReason: open ? null : e.state !== "published" ? "This event is no longer open for bids." : "The closing time has passed.",
      revisionNo: mine[0]?.revisionNo ?? 0,
      prices: Object.fromEntries((lines?.lines ?? []).map((l) => [l.itemId, l.unitPrice])),
      technicalText: tech?.text ?? "", total: lines?.total ?? null,
    };
  });
}

/** Price every line; the total is worked out here, on the server, from the prices only. */
export function priceBid(items: BidForm["items"], prices: Record<string, string>): BidOut<{ lines: BidLine[]; total: string }> {
  let total = 0n; const lines: BidLine[] = [];
  for (const it of items) {
    const raw = (prices[it.id] ?? "").trim();
    const p = parseDec(raw, 4);
    if (p === null || p <= 0n) return { ok: false, error: `Enter a price greater than zero for line ${it.lineNo} (up to 4 decimals).` };
    const qty = parseDec(it.quantity, 3) ?? 0n;
    const amt = it.blockType === "LUMP_SUM" ? rescale(p, 4, 2) : rescale(p * qty, 7, 2);
    total += amt;
    lines.push({ ...it, itemId: it.id, unitPrice: formatDec(p, 4, false), amount: formatDec(amt, 2, false) });
  }
  return { ok: true, lines, total: formatDec(total, 2, false) };
}

export async function submitBidForm(
  pool: Pool, who: SupplierWho, eventId: string,
  input: { prices: Record<string, string>; technicalText: string; idempotencyKey?: string },
): Promise<BidOut<{ revisionNo: number; total: string; duplicate: boolean }>> {
  const form = await getBidForm(pool, who, eventId);
  if (!form) return { ok: false, error: REASONS.NOT_FOUND! };
  if (!form.open) return { ok: false, error: form.closedReason! };
  if (!form.items.length) return { ok: false, error: "This event has no items to price." };
  const text = (input.technicalText ?? "").trim();
  if (text.length < 10) return { ok: false, error: "Describe your technical offer (at least 10 characters)." };
  if (text.length > 20000) return { ok: false, error: "The technical response is too long (20,000 characters at most)." };
  const priced = priceBid(form.items, input.prices ?? {});
  if (!priced.ok) return priced;
  const res = await withTenant(pool, who.tenantId, (c) => submitBid(c, actorOf(who), eventId, {
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    items: [
      { dataClass: "D7", kind: "price_lines", payload: { currency: form.event.currency, lines: priced.lines.map((l) => ({ itemId: l.itemId, lineNo: l.lineNo, quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount })), total: priced.total } },
      { dataClass: "D6", kind: "technical_response", payload: { text } },
    ],
  }));
  if (!res.ok) return { ok: false, error: REASONS[res.decision.reason] ?? "That bid could not be submitted." };
  return { ok: true, revisionNo: res.revisionNo, total: priced.total, duplicate: res.duplicate };
}
