import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { readBidItems, resolvePermitted, submitBid, withTenant, type Actor } from "@/authz";
import { formatDec, parseDec, rescale } from "@/engine";
import { resolveConfig } from "@/config/service";
import { lotsOf, type Lot } from "@/lots/service";
import type { SupplierWho } from "@/suppliers/service";
import { checkAnswers, isRequired, supplierView, type Answers, type SupplierView } from "@/templates/response";
import type { Effective } from "@/templates/types";
import { applyTiers, type Tier } from "@/boq/tiers";

export const NO_BID = "NB";   // price-field value meaning "declined this optional line"
export interface BidLine { noBid?: boolean; itemId: string; lineNo: number; description: string; quantity: string; unit: string; blockType: string; unitPrice: string; amount: string; lotId?: string; lotNo?: number; basePrice?: string; tiers?: Tier[]; appliedTier?: Tier | null }
export interface AltInput { label: string; note: string; prices: Record<string, string> }
export interface BundleInput { lotIds: string[]; discountPct: string }
export interface LotTotal { lotId: string; lotNo: number; total: string }
export interface BidForm {
  event: { id: string; ref: string; title: string; currency: string; closesAt: string | null; state: string; timeZone: string; roundNo: number };
  items: { id: string; lineNo: number; description: string; quantity: string; unit: string; blockType: string; lotId: string | null; zeroOk?: boolean; specification?: string | null; requiredDate?: string | null; materialGroup?: string | null; section?: string | null }[];
  lots: Lot[];                        // empty when the event is not split into lots
  open: boolean; closedReason: string | null;
  revisionNo: number;                 // 0 = nothing submitted yet
  prices: Record<string, string>;     // itemId -> price as last submitted
  tiers: Record<string, Tier[]>;      // itemId -> price breaks as last submitted
  alternates: AltInput[];             // alternate whole-bid offers as last submitted (events without lots)
  bundles: BundleInput[];             // discounts for winning several lots together (events with lots)
  technicalText: string;
  total: string | null;               // as last submitted
  gates: string[];                    // mandatory declarations this event asks for
  gateAnswers: Record<string, boolean>;
  questionnaire: SupplierView | null; // the template questions this event asks, when it was created from a template
  answers: Answers;                   // as last submitted (technical and commercial together)
  docFiles: Record<string, number>;   // requested document key -> files this supplier has attached to it
  submittedAt: string | null;
  fingerprint: string | null;         // short code that identifies exactly what was submitted
}

/** A short reproducible code over the submitted content, printed on the receipt. */
export function fingerprintOf(ref: string, revisionNo: number, lines: { lineNo: number; unitPrice: string }[], total: string, text: string, gates: Record<string, boolean>): string {
  const canon = JSON.stringify({ ref, revisionNo, lines: [...lines].sort((a, b) => a.lineNo - b.lineNo).map((l) => [l.lineNo, l.unitPrice]), total, text, gates: Object.entries(gates).sort(([a], [b]) => a.localeCompare(b)) });
  return createHash("sha256").update(canon).digest("hex").slice(0, 16).toUpperCase();
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
    const ev = (await c.query(`select ref, title, currency, template_effective, template_inputs from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev) return null;
    const tzRaw = (await c.query(`select time_zone from company_profile`)).rows[0]?.time_zone as string | undefined;
    const timeZone = tzRaw && (() => { try { new Intl.DateTimeFormat("en", { timeZone: tzRaw }); return true; } catch { return false; } })() ? tzRaw : "UTC";
    const zeroLines = new Set(((ev.template_effective as Effective | null)?.pricing.lines ?? []).filter((l) => l.optional).map((l) => l.key));
    const items = (await c.query(`select id, line_no, description, quantity::text as quantity, unit, block_type, lot_id, template_line, specification, to_char(required_date, 'YYYY-MM-DD') as required_date, material_group, section from event_item where event_id = $1 order by line_no`, [eventId])).rows
      .map((x) => ({ id: x.id as string, lineNo: x.line_no as number, description: x.description as string, quantity: x.quantity as string, unit: x.unit as string, blockType: x.block_type as string, lotId: (x.lot_id as string | null) ?? null, specification: (x.specification as string | null) ?? null, requiredDate: (x.required_date as string | null) ?? null, materialGroup: (x.material_group as string | null) ?? null, section: (x.section as string | null) ?? null, zeroOk: zeroLines.has(String(x.template_line ?? "").split(":")[0] ?? "") }));
    const lots = await lotsOf(c, eventId);
    const mine = (await readBidItems(c, actor, eventId)).filter((b) => b.supplierId === who.supplierId);
    const lines = mine.find((b) => b.kind === "price_lines")?.payload as { lines?: { itemId: string; unitPrice: string; basePrice?: string; tiers?: Tier[]; noBid?: boolean }[]; total?: string; alternates?: { label: string; note: string; lines: { itemId: string; unitPrice: string; noBid?: boolean }[] }[]; bundles?: { lotIds: string[]; discountPct: string }[] } | undefined;
    const tech = mine.find((b) => b.kind === "technical_response")?.payload as { text?: string; gates?: { name: string; answer: boolean }[] } | undefined;
    const gates = (await resolveConfig(c, eventId)).gates ?? [];
    const questionnaire = ev.template_effective ? supplierView(ev.template_effective as Effective, (ev.template_inputs?.values ?? {}) as Record<string, unknown>) : null;
    const answers: Answers = { ...((mine.find((b) => b.kind === "form_response")?.payload as { answers?: Answers } | undefined)?.answers ?? {}), ...((mine.find((b) => b.kind === "commercial_response")?.payload as { answers?: Answers } | undefined)?.answers ?? {}) };
    const docFiles = Object.fromEntries((await c.query(`select doc_key, count(*)::int n from stored_object where event_id = $1 and supplier_id = $2 and data_class = 'D6' and doc_key is not null group by doc_key`, [eventId, who.supplierId])).rows.map((r) => [r.doc_key as string, r.n as number]));
    const gateAnswers = Object.fromEntries((tech?.gates ?? []).map((g) => [g.name, g.answer]));
    const sub = mine.length ? (await c.query(`select submitted_at from bid_revision where event_id = $1 and supplier_id = $2 order by revision_no desc limit 1`, [eventId, who.supplierId])).rows[0] : null;
    const closed = e.closesAt && e.closesAt.getTime() <= Date.now();
    const shortlisted = e.roundNo <= 1 || (await c.query(`select 1 from event_round where event_id = $1 and round_no = $2 and $3::uuid = any(shortlist)`, [eventId, e.roundNo, who.supplierId])).rowCount! > 0;
    const open = e.state === "published" && !closed && shortlisted;
    return {
      event: { id: eventId, ref: ev.ref, title: ev.title, currency: ev.currency ?? "", closesAt: e.closesAt ? e.closesAt.toISOString() : null, state: e.state, timeZone, roundNo: e.roundNo },
      items, lots, open,
      closedReason: open ? null : e.state !== "published" ? "This event is no longer open for bids." : !shortlisted ? "This event is in a final round for shortlisted bidders only." : "The closing time has passed.",
      revisionNo: mine[0]?.revisionNo ?? 0,
      prices: Object.fromEntries((lines?.lines ?? []).map((l) => [l.itemId, l.noBid ? NO_BID : (l.basePrice ?? l.unitPrice)])),
      tiers: Object.fromEntries((lines?.lines ?? []).filter((l) => l.tiers?.length).map((l) => [l.itemId, l.tiers!])),
      alternates: (lines?.alternates ?? []).map((a) => ({ label: a.label, note: a.note, prices: Object.fromEntries(a.lines.map((l) => [l.itemId, l.noBid ? NO_BID : l.unitPrice])) })),
      bundles: (lines?.bundles ?? []).map((b) => ({ lotIds: b.lotIds, discountPct: b.discountPct })),
      technicalText: tech?.text ?? "", total: lines?.total ?? null,
      gates, gateAnswers, questionnaire, answers, docFiles, submittedAt: sub ? new Date(sub.submitted_at).toISOString() : null,
      fingerprint: mine.length && lines?.total ? fingerprintOf(ev.ref, mine[0]!.revisionNo, (lines.lines ?? []).map((l) => ({ lineNo: items.find((i) => i.id === l.itemId)?.lineNo ?? 0, unitPrice: l.unitPrice })), lines.total, tech?.text ?? "", gateAnswers) : null,
    };
  });
}

/** Price every line; the total is worked out here, on the server, from the prices only. With lots, a lot is priced whole or left empty. */
export function priceBid(items: BidForm["items"], prices: Record<string, string>, lots: Lot[] = [], tiers: Record<string, Tier[]> = {}): BidOut<{ lines: BidLine[]; total: string; lotTotals: LotTotal[] }> {
  let total = 0n; const lines: BidLine[] = []; const lotTotals: LotTotal[] = [];
  const priceLine = (it: BidForm["items"][number]): BidOut<{ line: BidLine; amt: bigint }> => {
    if ((prices[it.id] ?? "").trim().toUpperCase() === NO_BID) {
      if (!it.zeroOk) return { ok: false, error: `Line ${it.lineNo} cannot be declined. Enter a price greater than zero.` };
      return { ok: true, amt: 0n, line: { lineNo: it.lineNo, description: it.description, quantity: it.quantity, unit: it.unit, blockType: it.blockType, itemId: it.id, unitPrice: "0.0000", amount: "0.00", noBid: true } };
    }
    const base = parseDec((prices[it.id] ?? "").trim(), 4);
    if (base === null || base < 0n || (base === 0n && !it.zeroOk)) return { ok: false, error: `Enter a price greater than zero for line ${it.lineNo} (up to 4 decimals).` };
    const qty = parseDec(it.quantity, 3) ?? 0n;
    let p = base; let extra: Pick<BidLine, "basePrice" | "tiers" | "appliedTier"> = {};
    const tl = tiers[it.id];
    if (tl?.some((t) => String(t.minQty ?? "").trim() || String(t.unitPrice ?? "").trim())) {
      if (it.blockType === "LUMP_SUM") return { ok: false, error: `Line ${it.lineNo} is a lump sum, so it cannot have price breaks.` };
      const ck = applyTiers((prices[it.id] ?? "").trim(), tl, it.quantity, it.lineNo);
      if (!ck.ok) return ck;
      p = ck.effective;
      if (ck.tiers.length) extra = { basePrice: formatDec(base, 4, false), tiers: ck.tiers, appliedTier: ck.applied };
    }
    const amt = it.blockType === "LUMP_SUM" ? rescale(p, 4, 2) : rescale(p * qty, 7, 2);
    return { ok: true, amt, line: { lineNo: it.lineNo, description: it.description, quantity: it.quantity, unit: it.unit, blockType: it.blockType, itemId: it.id, unitPrice: formatDec(p, 4, false), amount: formatDec(amt, 2, false), ...extra } };
  };
  if (!lots.length) {
    for (const it of items) { const r = priceLine(it); if (!r.ok) return r; total += r.amt; lines.push(r.line); }
    if (total === 0n) return { ok: false, error: "The bid total must be greater than zero." };
    return { ok: true, lines, total: formatDec(total, 2, false), lotTotals };
  }
  for (const lot of lots) {
    const its = items.filter((i) => i.lotId === lot.id);
    const filled = its.filter((i) => (prices[i.id] ?? "").trim() !== "");
    if (!filled.length) continue;                                           // no bid on this lot
    if (filled.length < its.length) return { ok: false, error: `Price every line in lot ${lot.lotNo} or leave the whole lot empty.` };
    let lotSum = 0n;
    for (const it of its) { const r = priceLine(it); if (!r.ok) return r; lotSum += r.amt; lines.push({ ...r.line, lotId: lot.id, lotNo: lot.lotNo }); }
    total += lotSum; lotTotals.push({ lotId: lot.id, lotNo: lot.lotNo, total: formatDec(lotSum, 2, false) });
  }
  if (!lotTotals.length) return { ok: false, error: "Price at least one lot." };
  return { ok: true, lines, total: formatDec(total, 2, false), lotTotals };
}

export async function submitBidForm(
  pool: Pool, who: SupplierWho, eventId: string,
  input: { prices: Record<string, string>; technicalText: string; gates?: Record<string, boolean>; answers?: Record<string, unknown>; idempotencyKey?: string; tiers?: Record<string, Tier[]>; alternates?: AltInput[]; bundles?: BundleInput[] },
): Promise<BidOut<{ revisionNo: number; total: string; duplicate: boolean }>> {
  const form = await getBidForm(pool, who, eventId);
  if (!form) return { ok: false, error: REASONS.NOT_FOUND! };
  if (!form.open) return { ok: false, error: form.closedReason! };
  if (!form.items.length) return { ok: false, error: "This event has no items to price." };
  const text = (input.technicalText ?? "").trim();
  if (text.length < 10) return { ok: false, error: "Describe your technical offer (at least 10 characters)." };
  if (text.length > 20000) return { ok: false, error: "The technical response is too long (20,000 characters at most)." };
  const answers = input.gates ?? {};
  for (const g of form.gates) if (typeof answers[g] !== "boolean") return { ok: false, error: `Answer Yes or No: "${g}".` };
  const gateList = form.gates.map((g) => ({ name: g, answer: answers[g] as boolean }));
  let tech: Answers = {}, comm: Answers = {};
  if (form.questionnaire) {
    const chk = checkAnswers(form.questionnaire, input.answers ?? {});
    if (!chk.ok) return { ok: false, error: chk.error.replace("{0}", chk.label?.en ?? chk.key) };
    tech = chk.technical; comm = chk.commercial;
    const all = { ...tech, ...comm };
    for (const d of form.questionnaire.documents) {
      if (isRequired({ key: d.key, label: d.label, type: "text", envelope: d.envelope, required: d.required, section: "general" }, all) && !((form.docFiles[d.key] ?? 0) > 0)) return { ok: false, error: "Attach the required document: {0}.".replace("{0}", d.label.en) };
    }
  }
  const priced = priceBid(form.items, input.prices ?? {}, form.lots, input.tiers ?? {});
  if (!priced.ok) return priced;
  // Alternate whole-bid offers (events without lots) and bundle discounts (events with lots).
  const alts: { label: string; note: string; total: string; lines: { itemId: string; lineNo: number; quantity: string; unitPrice: string; amount: string; noBid?: boolean }[] }[] = [];
  const altIn = (input.alternates ?? []).filter((a) => a && (String(a.label ?? "").trim() || Object.values(a.prices ?? {}).some((v) => String(v).trim())));
  if (altIn.length) {
    if (form.lots.length) return { ok: false, error: "Alternate offers are for events without lots. Use a bundle discount instead." };
    if (altIn.length > 2) return { ok: false, error: "Offer at most 2 alternates." };
    for (const [i, a] of altIn.entries()) {
      const label = String(a.label ?? "").trim().replace(/\s+/g, " "), note = String(a.note ?? "").trim();
      if (label.length < 2 || label.length > 60) return { ok: false, error: `Alternate ${i + 1}: give it a name of 2 to 60 characters.` };
      if (note.length < 10 || note.length > 1000) return { ok: false, error: `Alternate ${i + 1}: describe how it differs from your main offer (10 to 1,000 characters).` };
      const ap = priceBid(form.items, a.prices ?? {}, []);
      if (!ap.ok) return { ok: false, error: `Alternate ${i + 1}: ${ap.error}` };
      alts.push({ label, note, total: ap.total, lines: ap.lines.map((l) => ({ itemId: l.itemId, lineNo: l.lineNo, quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, ...(l.noBid ? { noBid: true } : {}) })) });
    }
  }
  const bundles: { lotIds: string[]; lotNos: number[]; discountPct: string }[] = [];
  const bunIn = (input.bundles ?? []).filter((b) => b && ((b.lotIds ?? []).length || String(b.discountPct ?? "").trim()));
  if (bunIn.length) {
    if (!form.lots.length) return { ok: false, error: "Bundle discounts are for events with lots." };
    if (bunIn.length > 5) return { ok: false, error: "Offer at most 5 bundle discounts." };
    const seen = new Set<string>();
    for (const [i, b] of bunIn.entries()) {
      const ids = [...new Set(b.lotIds ?? [])].sort();
      if (ids.length < 2 || ids.some((id) => !form.lots.some((l) => l.id === id))) return { ok: false, error: `Bundle ${i + 1}: choose two or more lots of this event.` };
      const pct = parseDec(String(b.discountPct ?? "").trim(), 2);
      if (pct === null || pct < 1n || pct > 5000n) return { ok: false, error: `Bundle ${i + 1}: the discount must be between 0.01 and 50 percent.` };
      const tot = form.lots.filter((l) => ids.includes(l.id));
      if (tot.some((l) => !priced.lotTotals.some((t) => t.lotId === l.id))) return { ok: false, error: `Bundle ${i + 1}: you have not priced every lot in it.` };
      if (seen.has(ids.join(","))) return { ok: false, error: `Bundle ${i + 1} repeats an earlier bundle.` };
      seen.add(ids.join(","));
      bundles.push({ lotIds: ids, lotNos: tot.map((l) => l.lotNo), discountPct: formatDec(pct, 2, false) });
    }
  }
  const res = await withTenant(pool, who.tenantId, (c) => submitBid(c, actorOf(who), eventId, {
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    items: [
      { dataClass: "D7", kind: "price_lines", payload: { currency: form.event.currency, lines: priced.lines.map((l) => ({ itemId: l.itemId, lineNo: l.lineNo, quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, ...(l.noBid ? { noBid: true } : {}), ...(l.lotId ? { lotId: l.lotId, lotNo: l.lotNo } : {}), ...(l.tiers ? { basePrice: l.basePrice, tiers: l.tiers, appliedTier: l.appliedTier } : {}) })), total: priced.total, ...(alts.length ? { alternates: alts } : {}), ...(bundles.length ? { bundles } : {}), ...(priced.lotTotals.length ? { lots: priced.lotTotals } : {}) } },
      { dataClass: "D6", kind: "technical_response", payload: { text, gates: gateList } },
      ...(form.questionnaire ? [{ dataClass: "D6" as const, kind: "form_response", payload: { answers: tech } }, { dataClass: "D7" as const, kind: "commercial_response", payload: { answers: comm } }] : []),
    ],
  }));
  if (!res.ok) return { ok: false, error: REASONS[res.decision.reason] ?? "That bid could not be submitted." };
  return { ok: true, revisionNo: res.revisionNo, total: priced.total, duplicate: res.duplicate };
}

export interface SubmissionCheck { held: boolean; revisionNo: number; submittedAt: string | null; lines: number; total: string | null; fingerprint: string | null; matches: boolean | null }

/** Lets a bidder confirm what the system holds for them, and compare it with the code on their receipt. Read-only. */
export async function checkSubmission(pool: Pool, who: SupplierWho, eventId: string, code?: string): Promise<BidOut<{ check: SubmissionCheck }>> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return { ok: false, error: "Event not found." };
  const f = await getBidForm(pool, who, eventId);
  if (!f) return { ok: false, error: "Event not found." };
  const entered = (code ?? "").replace(/[^0-9a-f]/gi, "").toUpperCase();
  const held = f.revisionNo > 0 && !!f.fingerprint;
  return { ok: true, check: {
    held, revisionNo: f.revisionNo, submittedAt: f.submittedAt, total: f.total, fingerprint: f.fingerprint,
    lines: Object.values(f.prices).filter((v) => v !== "").length,
    matches: entered ? (held && entered === f.fingerprint) : null } };
}
