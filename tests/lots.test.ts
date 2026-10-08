import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBidForm, priceBid, submitBidForm } from "@/bids/service";
import { priceSheet } from "@/bids/sheet";
import { approveAwardNow, getCommercialView, openCommercialEnvelopes, recordRecommendation, submitForAward } from "@/commercial/service";
import { addItem, duplicateEvent, getEvent, importItems, saveAsTemplate, createFromTemplate, type Who } from "@/events/service";
import { itemsTemplate, parseItemsSheet } from "@/events/sheet";
import { submitForPublication } from "@/events/workflow";
import { listAwarded, previewPayload, sendHandover } from "@/handover/service";
import { addLot, currentAwards, deleteLot, setItemLot } from "@/lots/service";
import { awardsReport } from "@/reports/service";
import { getAwardPack } from "@/pack/service";
import type { SupplierWho } from "@/suppliers/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"], role = "member"): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role } as Who);
const sup = (i: 0 | 1 | 2): SupplierWho => ({ tenantId: X.tenantId, supplierId: X.suppliers[i].id, supplierUserId: X.suppliers[i].supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });
const ver = async (id: string) => (await admin.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;

beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "lots"); });
afterAll(async () => { await pool.end(); await admin.end(); });

async function draftEvent() {
  return (await makeEvent(admin, X, "draft", { withBids: false })).id;
}

describe("lots on a draft event", () => {
  it("adds, assigns, deletes lots and refuses to publish with loose items", async () => {
    const id = await draftEvent();
    const a = await addLot(pool, who("requester"), id, "Pumps"); const b = await addLot(pool, who("requester"), id, "  Valves ");
    if (!a.ok || !b.ok) throw new Error("lot");
    expect(b.lot).toMatchObject({ lotNo: 2, name: "Valves" });
    expect(await addLot(pool, who("requester"), id, "pumps")).toMatchObject({ ok: false });               // same name, any capitals
    expect(await addLot(pool, who("requester"), id, "   ")).toMatchObject({ ok: false });
    expect(await addLot(pool, who("requester", "viewer"), id, "X")).toMatchObject({ ok: false });
    const i1 = await addItem(pool, who("requester"), id, { description: "Pump", quantity: "2", unit: "EA", lotId: a.lot.id });
    const i2 = await addItem(pool, who("requester"), id, { description: "Valve", quantity: "5", unit: "EA" });
    if (!i1.ok || !i2.ok) throw new Error("item");
    expect(await addItem(pool, who("requester"), id, { description: "Bad", quantity: "1", unit: "EA", lotId: randomUUID() })).toMatchObject({ ok: false });
    // publishing: a loose item blocks, then an empty lot blocks, then it passes the lot check
    expect(await submitForPublication(pool, who("buyer"), id, await ver(id))).toMatchObject({ ok: false, error: expect.stringContaining("every item in a lot") });
    expect(await setItemLot(pool, who("requester"), id, i2.item.id, b.lot.id)).toMatchObject({ ok: true });
    const c = await addLot(pool, who("requester"), id, "Spares"); if (!c.ok) throw new Error("lot");
    expect(await submitForPublication(pool, who("buyer"), id, await ver(id))).toMatchObject({ ok: false, error: expect.stringContaining("at least one item") });
    expect(await deleteLot(pool, who("requester"), id, c.lot.id)).toMatchObject({ ok: true });
    expect(await deleteLot(pool, who("requester"), id, b.lot.id)).toMatchObject({ ok: true });              // its item stays, without a lot
    const e = (await getEvent(pool, who("requester"), id))!;
    expect(e.lots.map((l) => l.name)).toEqual(["Pumps"]);
    expect(e.items.map((i) => i.lotId)).toEqual([a.lot.id, null]);
    // once the event leaves draft, lots are frozen
    await admin.query(`update sourcing_event set state = 'published' where id = $1`, [id]);
    expect(await addLot(pool, who("requester"), id, "Late")).toMatchObject({ ok: false });
  });
  it("imports a Lot column, duplicates and templates keep the lots", async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("S");
    [["Description", "Quantity", "Unit", "Lot"], ["Pump", 2, "EA", "Pumps"], ["Seal", 4, "EA", "pumps"], ["Install", 1, "LS", "Services"], ["Loose", 1, "EA", ""]].forEach((r) => ws.addRow(r));
    const r = await parseItemsSheet("a.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    if (!("rows" in r)) throw new Error("sheet");
    expect(r.rows.map((x) => x.lot)).toEqual(["Pumps", "pumps", "Services", undefined]);
    const id = await draftEvent();
    expect(await importItems(pool, who("requester"), id, r.rows)).toMatchObject({ ok: true, added: 4 });
    const e = (await getEvent(pool, who("requester"), id))!;
    expect(e.lots.map((l) => l.name)).toEqual(["Pumps", "Services"]);                                       // "pumps" joined the first lot
    expect(e.items.map((i) => e.lots.find((l) => l.id === i.lotId)?.name ?? null)).toEqual(["Pumps", "Pumps", "Services", null]);
    const dup = await duplicateEvent(pool, who("requester"), id); if (!dup.ok) throw new Error("dup");
    const d = (await getEvent(pool, who("requester"), dup.id))!;
    expect(d.lots.map((l) => [l.lotNo, l.name])).toEqual([[1, "Pumps"], [2, "Services"]]);
    expect(d.items.map((i) => d.lots.find((l) => l.id === i.lotId)?.name ?? null)).toEqual(["Pumps", "Pumps", "Services", null]);
    expect(d.lots[0]!.id).not.toBe(e.lots[0]!.id);
    const t = await saveAsTemplate(pool, who("requester"), id, "Pump package"); if (!t.ok) throw new Error("tpl");
    const n = await createFromTemplate(pool, who("requester"), t.id, { title: "From template" }); if (!n.ok) throw new Error("new");
    const g = (await getEvent(pool, who("requester"), n.event.id))!;
    expect(g.lots.map((l) => l.name)).toEqual(["Pumps", "Services"]);
    expect(g.items.filter((i) => i.lotId).length).toBe(3);
  });
  it("the item template has a Lot column", async () => {
    const r = await parseItemsSheet("t.xlsx", await itemsTemplate());
    expect(r).toMatchObject({ total: 2, errors: [] });
    if ("rows" in r) expect(r.rows.map((x) => x.lot)).toEqual(["Pumps", "Services"]);
  });
});

/** A live event with two lots: lot 1 has two lines, lot 2 has one. */
async function liveLotEvent() {
  const ev = (await admin.query(`insert into sourcing_event (tenant_id, title, state, ref, currency, closes_at) values ($1, 'Split', 'draft', $2, 'AED', $3) returning id`,
    [X.tenantId, "EV-" + randomUUID().slice(0, 8), new Date(Date.now() + 3600_000).toISOString()])).rows[0].id as string;
  const lots: string[] = [];
  for (const [n, name] of [[1, "Pumps"], [2, "Services"]] as const) lots.push((await admin.query(`insert into event_lot (tenant_id, event_id, lot_no, name) values ($1,$2,$3,$4) returning id`, [X.tenantId, ev, n, name])).rows[0].id);
  const ids: string[] = [];
  for (const [n, q, t, l] of [[1, "10", "UNIT_PRICE", 0], [2, "1", "LUMP_SUM", 0], [3, "1", "LUMP_SUM", 1]] as const)
    ids.push((await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type, lot_id) values ($1,$2,$3,'Item',$4,'ea',$5,$6) returning id`, [X.tenantId, ev, n, q, t, lots[l]])).rows[0].id);
  await admin.query(`update sourcing_event set state = 'published' where id = $1`, [ev]);
  for (const i of [0, 1] as const) await admin.query(`insert into invitation (tenant_id, event_id, supplier_id, supplier_user_id, token_hash) values ($1,$2,$3,$4,$5)`, [X.tenantId, ev, X.suppliers[i].id, X.suppliers[i].supplierUserId, randomUUID()]);
  return { ev, ids, lots };
}

describe("bidding on lots", () => {
  it("prices a lot whole or not at all", async () => {
    const { ev, ids, lots } = await liveLotEvent();
    const form = (await getBidForm(pool, sup(0), ev))!;
    expect(form.lots.map((l) => l.name)).toEqual(["Pumps", "Services"]);
    const lot1 = { [ids[0]!]: "10", [ids[1]!]: "50" };
    expect(priceBid(form.items, lot1, form.lots)).toMatchObject({ ok: true, total: "150.00", lotTotals: [{ lotNo: 1, total: "150.00" }] });
    expect(priceBid(form.items, { [ids[0]!]: "10" }, form.lots)).toMatchObject({ ok: false, error: "Price every line in lot 1 or leave the whole lot empty." });
    expect(priceBid(form.items, {}, form.lots)).toMatchObject({ ok: false, error: "Price at least one lot." });
    expect(priceBid(form.items, { ...lot1, [ids[2]!]: "0" }, form.lots)).toMatchObject({ ok: false });
    // submit lot 1 only, then revise to bid on both
    expect(await submitBidForm(pool, sup(0), ev, { prices: lot1, technicalText: "We comply with the full spec." })).toMatchObject({ ok: true, revisionNo: 1, total: "150.00" });
    const mine = (await getBidForm(pool, sup(0), ev))!;
    expect(mine).toMatchObject({ total: "150.00" }); expect(Object.keys(mine.prices).sort()).toEqual([ids[0]!, ids[1]!].sort());
    expect(await submitBidForm(pool, sup(0), ev, { prices: { ...lot1, [ids[2]!]: "300" }, technicalText: "We comply with the full spec." })).toMatchObject({ ok: true, revisionNo: 2, total: "450.00" });
    const stored = (await admin.query(`select bi.payload from bid_item bi join bid_revision br on br.id = bi.bid_revision_id where br.event_id = $1 and bi.kind = 'price_lines' order by br.revision_no desc limit 1`, [ev])).rows[0].payload;
    expect(stored.lots).toEqual([{ lotId: lots[0], lotNo: 1, total: "150.00" }, { lotId: lots[1], lotNo: 2, total: "300.00" }]);
    expect(stored.lines.map((l: { lotNo: number }) => l.lotNo)).toEqual([1, 1, 2]);
  });
  it("the price sheet has a Lot column and the same sheet still reads back", async () => {
    const { ev } = await liveLotEvent();
    const form = (await getBidForm(pool, sup(0), ev))!;
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await priceSheet(form)) as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.getRow(1).values).toEqual(expect.arrayContaining(["Lot"]));
    expect(String(wb.worksheets[0]!.getRow(2).getCell(2).value)).toBe("1. Pumps");
  });
});

/** Both suppliers qualified; lot 1 priced by both, lot 2 by supplier 1 only. Technical 90 and 80. */
async function approvedLotEvent(o: { lot2Bids?: boolean } = {}) {
  const e = await makeEvent(admin, X, "technical_approved", { withBids: false });
  await admin.query(`delete from tech_result where event_id = $1`, [e.id]);
  await admin.query(`delete from qualified_bidder where event_id = $1`, [e.id]);
  await admin.query(`update sourcing_event set state = 'draft' where id = $1`, [e.id]);
  const lots: string[] = [];
  for (const [n, name] of [[1, "Pumps"], [2, "Services"]] as const) lots.push((await admin.query(`insert into event_lot (tenant_id, event_id, lot_no, name) values ($1,$2,$3,$4) returning id`, [X.tenantId, e.id, n, name])).rows[0].id);
  for (const [n, l] of [[1, 0], [2, 1]] as const) await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, lot_id) values ($1,$2,$3,'Item',1,'EA',$4)`, [X.tenantId, e.id, n, lots[l]]);
  await admin.query(`update sourcing_event set state = 'technical_approved', currency = 'AED' where id = $1`, [e.id]);
  const bids = [{ s: 0, l1: "1000.00", l2: o.lot2Bids === false ? null : "500.00", tech: 90 }, { s: 1, l1: "800.00", l2: null, tech: 80 }];
  for (const b of bids) {
    const rev = (await admin.query(`insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key) values ($1,$2,$3,1,$4) returning id`, [X.tenantId, e.id, X.suppliers[b.s]!.id, randomUUID()])).rows[0].id;
    const total = (Number(b.l1) + Number(b.l2 ?? 0)).toFixed(2);
    const payload = { currency: "AED", total, lots: [{ lotId: lots[0], lotNo: 1, total: b.l1 }, ...(b.l2 ? [{ lotId: lots[1], lotNo: 2, total: b.l2 }] : [])],
      lines: [{ lineNo: 1, unitPrice: b.l1, amount: b.l1, lotId: lots[0], lotNo: 1 }, ...(b.l2 ? [{ lineNo: 2, unitPrice: b.l2, amount: b.l2, lotId: lots[1], lotNo: 2 }] : [])] };
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D7','price_lines',$3)`, [X.tenantId, rev, JSON.stringify(payload)]);
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D6','technical_response',$3)`, [X.tenantId, rev, JSON.stringify({ text: "tech" })]);
    await admin.query(`insert into tech_result (tenant_id, event_id, supplier_id, total, qualified) values ($1,$2,$3,$4,true)`, [X.tenantId, e.id, X.suppliers[b.s]!.id, b.tech]);
    await admin.query(`insert into qualified_bidder (tenant_id, event_id, supplier_id) values ($1,$2,$3)`, [X.tenantId, e.id, X.suppliers[b.s]!.id]);
  }
  return { id: e.id, lots };
}

describe("ranking, recommending, awarding and handing over by lot", () => {
  it("ranks each lot separately and awards a supplier per lot", async () => {
    const { id, lots } = await approvedLotEvent();
    const [s1, s2] = [X.suppliers[0].id, X.suppliers[1].id];
    expect(await getCommercialView(pool, who("buyer"), id)).toMatchObject({ comparison: null });            // sealed until opened
    expect(await openCommercialEnvelopes(pool, who("buyer"), id, await ver(id), X.people.witness.membershipId)).toMatchObject({ ok: true });
    const v = (await getCommercialView(pool, who("buyer"), id))!;
    const c = v.comparison!;
    expect(c.rows).toEqual([]);
    // lot 1: S1 90/80.00 -> 83.00; S2 80/100.00 -> 94.00. lot 2: only S1, commercial 100.00 -> 0.3*90+0.7*100 = 97.00
    expect(c.lots!.map((l) => l.rows.map((r) => [r.supplierId === s1 ? "S1" : "S2", r.rank, r.commercial, r.final]))).toEqual([[["S2", 1, "100.00", "94.00"], ["S1", 2, "80.00", "83.00"]], [["S1", 1, "100.00", "97.00"]]]);
    expect(c.lots![0]!.lines[0]).toMatchObject({ lineNo: 1 }); expect(c.lots![1]!.lines).toHaveLength(1);

    const note = "Best weighted score in each lot";
    expect(await recordRecommendation(pool, who("buyer"), id, await ver(id), s2, note)).toMatchObject({ ok: false });                 // one supplier is not enough
    expect(await recordRecommendation(pool, who("buyer"), id, await ver(id), { [lots[0]!]: s2 }, note)).toMatchObject({ ok: false, error: "Choose a supplier for lot 2." });
    expect(await recordRecommendation(pool, who("buyer"), id, await ver(id), { [lots[0]!]: s2, [lots[1]!]: s2 }, note)).toMatchObject({ ok: false });   // S2 did not bid lot 2
    expect(await recordRecommendation(pool, who("buyer"), id, await ver(id), { [lots[0]!]: s2, [lots[1]!]: s1, [randomUUID()]: s1 }, note)).toMatchObject({ ok: false });
    expect(await recordRecommendation(pool, who("buyer"), id, await ver(id), { [lots[0]!]: s2, [lots[1]!]: s1 }, note)).toMatchObject({ ok: true });
    expect(await submitForAward(pool, who("buyer"), id, await ver(id))).toMatchObject({ ok: true });
    const a = (await getCommercialView(pool, who("awardApprover"), id))!;
    expect(a.lotAwards.map((x) => [x.lotNo, x.supplierId])).toEqual([[1, s2], [2, s1]]);
    expect(a.comparison!.lots).toHaveLength(2);                                                               // stored calculation keeps the lots
    expect(await approveAwardNow(pool, who("awardApprover"), id, await ver(id))).toMatchObject({ ok: true });
    expect((await getCommercialView(pool, who("buyer"), id))!.state).toBe("awarded");

    const pack = (await getAwardPack(pool, who("buyer"), id))!;
    expect(pack.lotAwards).toHaveLength(2); expect(pack.recommendation!.name).toContain("Supplier");

    // handover: one document per winning supplier, each with only its own lot
    const p = await previewPayload(pool, who("buyer"), id, "SAP");
    if (!p.ok) throw new Error(p.error);
    expect(p.payloads.map((x) => [x.vendor.name, x.totalNet, x.items.map((i) => [i.lineNo, i.lotNo])])).toEqual([["Supplier 2", "800.00", [[1, 1]]], ["Supplier 1", "500.00", [[2, 2]]]]);
    expect(await previewPayload(pool, who("buyer"), id, "SAP", s1)).toMatchObject({ ok: true, payloads: [{ vendor: { name: "Supplier 1" } }] });
    expect(await previewPayload(pool, who("buyer"), id, "SAP", X.suppliers[2].id)).toMatchObject({ ok: false });
    const one = await sendHandover(pool, who("buyer"), id, "SAP", s1);
    expect(one).toMatchObject({ ok: true, duplicate: false }); if (!one.ok) return;
    const all = await sendHandover(pool, who("buyer"), id, "SAP");
    expect(all).toMatchObject({ ok: true, duplicate: false });                                              // the other supplier was new
    if (!all.ok) return;
    expect(all.references.find((r) => r.supplierId === s1)).toMatchObject({ duplicate: true, reference: one.reference });
    expect(await sendHandover(pool, who("buyer"), id, "SAP")).toMatchObject({ ok: true, duplicate: true });
    expect((await admin.query(`select 1 from handover_log where event_id = $1`, [id])).rowCount).toBe(2);
    const row = (await listAwarded(pool, who("buyer"))).find((r) => r.id === id)!;
    expect(row.vendors.map((x) => [x.name, x.total, x.lots, x.last?.status])).toEqual([["Supplier 2", "800.00", ["1. Pumps"], "sent"], ["Supplier 1", "500.00", ["2. Services"], "sent"]]);
    expect(row.total).toBe("1300.00");

    // report: sums the lots; the saving is shown because every lot was awarded (estimate is 400000)
    const rep = (await awardsReport(pool, who("buyer"))).rows.find((r) => r.id === id)!;
    expect(rep).toMatchObject({ total: "1300.00", saving: "398700.00" }); expect(rep.supplier).toContain("Supplier 1");
  });
  it("a lot nobody bid on stays unawarded and gets no saving figure", async () => {
    const { id, lots } = await approvedLotEvent({ lot2Bids: false });
    const [s1, s2] = [X.suppliers[0].id, X.suppliers[1].id];
    await openCommercialEnvelopes(pool, who("buyer"), id, await ver(id), X.people.witness.membershipId);
    const c = (await getCommercialView(pool, who("buyer"), id))!.comparison!;
    expect(c.lots!.map((l) => l.rows.length)).toEqual([2, 0]);
    expect(await recordRecommendation(pool, who("buyer"), id, await ver(id), { [lots[0]!]: s2, [lots[1]!]: s1 }, "Lot 2 had no bids at all")).toMatchObject({ ok: false });
    expect(await recordRecommendation(pool, who("buyer"), id, await ver(id), { [lots[0]!]: s2 }, "Lot 2 had no bids at all")).toMatchObject({ ok: true });
    await submitForAward(pool, who("buyer"), id, await ver(id));
    expect(await approveAwardNow(pool, who("awardApprover"), id, await ver(id))).toMatchObject({ ok: true });
    const rep = (await awardsReport(pool, who("buyer"))).rows.find((r) => r.id === id)!;
    expect(rep).toMatchObject({ total: "800.00", saving: null, supplier: "Supplier 2" });
    expect(s1).toBeTruthy();
  });
  it("one supplier winning two lots gets one handover document; a send-back replaces the whole set", async () => {
    const { id, lots } = await approvedLotEvent();
    const [s1, s2] = [X.suppliers[0].id, X.suppliers[1].id];
    await openCommercialEnvelopes(pool, who("buyer"), id, await ver(id), X.people.witness.membershipId);
    expect(await recordRecommendation(pool, who("buyer"), id, await ver(id), { [lots[0]!]: s2, [lots[1]!]: s1 }, "First choice, split award")).toMatchObject({ ok: true });
    await submitForAward(pool, who("buyer"), id, await ver(id));
    const { rejectAward } = await import("@/commercial/service");
    expect(await rejectAward(pool, who("awardApprover"), id, await ver(id))).toMatchObject({ ok: true });
    expect(await recordRecommendation(pool, who("buyer"), id, await ver(id), { [lots[0]!]: s1, [lots[1]!]: s1 }, "Second choice, one supplier")).toMatchObject({ ok: true });
    expect((await admin.query(`select count(*)::int n from recommendation where event_id = $1`, [id])).rows[0].n).toBe(4);
    const { withTenant } = await import("@/authz");
    const awards = await withTenant(pool, X.tenantId, (cl) => currentAwards(cl, id));
    expect(awards.map((a) => [a.lotNo, a.supplierId === s1, a.total, a.note])).toEqual([[1, true, "1000.00", "Second choice, one supplier"], [2, true, "500.00", "Second choice, one supplier"]]);
    await submitForAward(pool, who("buyer"), id, await ver(id));
    await approveAwardNow(pool, who("awardApprover"), id, await ver(id));
    const p = await previewPayload(pool, who("buyer"), id, "ARIBA");
    if (!p.ok) throw new Error(p.error);
    expect(p.payloads).toHaveLength(1);
    expect(p.payload).toMatchObject({ totalNet: "1500.00", lots: [{ lotNo: 1 }, { lotNo: 2 }] });
    expect(p.payload.items.map((i) => i.lotNo)).toEqual([1, 2]);
  });
});
