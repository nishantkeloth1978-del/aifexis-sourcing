import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBidForm, submitBidForm, type BidForm } from "@/bids/service";
import { buildLaneGrid, checkTerms, itemIdsOf, meetsLimit } from "@/bids/lanes";
import { laneSheet, parseLaneSheet } from "@/bids/lanesheet";
import { buildLaneMatrix } from "@/commercial/lanes";
import { getCommercialView } from "@/commercial/service";
import type { Who } from "@/events/service";
import type { SupplierWho } from "@/suppliers/service";
import { createEventFromTemplate, updateTemplateInputs } from "@/templates/events";
import { parseGroupSheet, groupTemplate } from "@/templates/groupsheet";
import { TEMPLATES_5 } from "@/templates/packs";
import { resolve } from "@/templates/resolve";
import { buildSchedule, MAX_LANES } from "@/templates/schedule";
import { activate, saveProfile } from "@/templates/service";
import { validateContent } from "@/templates/validate";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";
import { openCommercialConfirmed } from "./helpers/confirmed";
import { isRequired, isVisible, type Answers } from "@/templates/response";

const FREIGHT = TEMPLATES_5[0]!;
const LANES = [
  { origin: "Khalifa Port", origin_code: "AEKHL", destination: "Nhava Sheva", dest_code: "INNSA", container: "40' HC", volume: "320", max_transit: "10" },
  { origin: "Khalifa Port", origin_code: "AEKHL", destination: "Shanghai", dest_code: "CNSHA", container: "40' HC", volume: "260", max_transit: "24" },
  { origin: "Khalifa Port", origin_code: "AEKHL", destination: "Rotterdam", dest_code: "NLRTM", container: "40' HC", volume: "150", max_transit: "26" },
];

describe("freight lane template content", () => {
  it("is valid, versioned 3, and builds five price lines for every lane", () => {
    const r = resolve(FREIGHT.content, []);
    expect(r.problems).toEqual([]);
    expect(validateContent(r.effective)).toEqual([]);
    expect(FREIGHT.version).toBe(3);
    expect(FREIGHT.meta.key).toBe("LOG_FREIGHT_RFQ");
    const s = buildSchedule(FREIGHT.content, { groups: { lane: LANES } });
    expect(s.incomplete).toBe(false);
    expect(s.items).toHaveLength(15);
    expect(s.items[0]).toMatchObject({ rowName: "Khalifa Port to Nhava Sheva", description: "Ocean freight: Khalifa Port to Nhava Sheva", quantity: "320.000", unit: "CONTAINER" });
    expect(s.items.slice(0, 5).map((i) => i.lineKey)).toEqual(["ocean_freight", "baf", "origin_thc", "dest_thc", "docs_other"]);
  });
  it("flags a lane with no volume, and more lanes than an event can have as lots", () => {
    const bad = buildSchedule(FREIGHT.content, { groups: { lane: [{ ...LANES[0]!, volume: "" }] } });
    expect(bad.incomplete).toBe(true);
    const many = buildSchedule(FREIGHT.content, { groups: { lane: Array.from({ length: MAX_LANES + 1 }, (_, i) => ({ ...LANES[0]!, destination: `Port ${i}` })) } });
    expect(many.incomplete).toBe(true);
    expect(many.items).toHaveLength(MAX_LANES * 5);
  });
});

describe("lane answers", () => {
  const items = buildSchedule(FREIGHT.content, { groups: { lane: LANES } }).items.map((it, i) => ({ id: `i${i}`, templateLine: `${it.lineKey}:${it.rowIndex}`, lotId: `lot${it.rowIndex}`, quantity: it.quantity }));
  const grid = buildLaneGrid(FREIGHT.content, { lane: LANES }, items)!;
  it("builds the grid and checks answers only for lanes that have a bid", () => {
    expect(grid.lanes).toHaveLength(3);
    expect(grid.components.map((c) => c.label.en)).toEqual(["Ocean freight", "Fuel surcharge (BAF)", "Origin port charges", "Destination port charges", "Documents and other charges"]);
    expect(grid.quantityKey).toBe("volume");
    const onlyFirst = Object.fromEntries(Object.values(grid.lanes[0]!.items).map((id) => [id, "10"]));
    expect(checkTerms(grid, {}, onlyFirst)).toMatchObject({ ok: false, error: "Lane 1: enter Transit offered (days)." });
    expect(checkTerms(grid, { "lane:0": { transit_days: "9x" } }, onlyFirst)).toMatchObject({ ok: false, error: "Lane 1: Transit offered (days) must be a whole number." });
    expect(checkTerms(grid, { "lane:0": { transit_days: "9", valid_until: "31/02/2027" } }, onlyFirst)).toMatchObject({ ok: false });
    const good = checkTerms(grid, { "lane:0": { transit_days: "9", sailings_week: "6", valid_until: "2027-09-30" }, "lane:1": { transit_days: "99" } }, onlyFirst);
    expect(good).toEqual({ ok: true, terms: { "lane:0": { transit_days: "9", sailings_week: "6", valid_until: "2027-09-30" } } });   // lane 2 has no bid, its answers are dropped
  });
  it("tells whether a lane meets the buyer's transit limit", () => {
    expect(meetsLimit(grid, grid.lanes[0]!, { transit_days: "9" })).toBe(true);
    expect(meetsLimit(grid, grid.lanes[0]!, { transit_days: "11" })).toBe(false);
    expect(meetsLimit(grid, grid.lanes[0]!, {})).toBeNull();
  });
  it("compares carriers lane by lane and prices the split against the best single carrier", () => {
    const line = (laneNo: number, prices: number[], qty = Number(LANES[laneNo]!.volume)) => Object.values(grid.lanes[laneNo]!.items).map((id, k) => ({ itemId: id, unitPrice: prices[k]!.toFixed(4), amount: (prices[k]! * qty).toFixed(2) }));
    const A = { supplierId: "A", name: "Carrier A", lines: [...line(0, [1000, 200, 90, 100, 60]), ...line(1, [1400, 300, 90, 140, 70]), ...line(2, [2300, 380, 90, 220, 80])], terms: { "lane:0": { transit_days: "9" } } };
    const B = { supplierId: "B", name: "Carrier B", lines: [...line(0, [1100, 200, 90, 100, 60]), ...line(1, [1300, 300, 90, 140, 70])], terms: { "lane:0": { transit_days: "12" } } };   // no bid on lane 3
    const m = buildLaneMatrix(grid, new Map([["lot0", 1], ["lot1", 2], ["lot2", 3]]), [A, B]);
    expect(m.rows.map((r) => r.lowest)).toEqual(["A", "B", "A"]);
    expect(m.rows[0]!.cells.A).toMatchObject({ priced: true, allIn: "1450.00", meets: true });
    expect(m.rows[0]!.cells.B).toMatchObject({ allIn: "1550.00", meets: false });
    expect(m.rows[2]!.cells.B!.priced).toBe(false);
    expect(m.single.find((s) => s.supplierId === "B")).toMatchObject({ annual: null, lanesPriced: 2, lanes: 3 });     // B did not price every lane
    expect(m.bestSingle).toMatchObject({ supplierId: "A", annual: String(1450 * 320 + 2000 * 260 + 3070 * 150) + ".00" });
    expect(m.byLane).toMatchObject({ annual: String(1450 * 320 + 1900 * 260 + 3070 * 150) + ".00", carriers: 2, lanesCovered: 3 });
    expect(m.saving).toBe(String(2000 * 260 - 1900 * 260) + ".00");
  });
});

describe("Excel for the supplier and for the buyer", () => {
  const items = buildSchedule(FREIGHT.content, { groups: { lane: LANES } }).items.map((it, i) => ({ id: `i${i}`, templateLine: `${it.lineKey}:${it.rowIndex}`, lotId: `lot${it.rowIndex}`, quantity: it.quantity }));
  const grid = buildLaneGrid(FREIGHT.content, { lane: LANES }, items)!;
  const form = { event: { id: "e", ref: "EV-1", title: "Freight 2027", currency: "USD" }, laneGrid: grid, laneTerms: { "lane:0": { transit_days: "9" } }, prices: { [grid.lanes[0]!.items.ocean_freight!]: "1180" }, items: [], lots: [] } as unknown as BidForm;
  it("round-trips: the sheet shows the lanes, a filled copy is read back, mistakes are named", async () => {
    const buf = await laneSheet(form);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Lane prices")!;
    const header = ws.getRow(5).values as (string | undefined)[];
    const col = (name: string) => header.findIndex((h) => h === name);
    expect(ws.getRow(6).getCell(2).value).toBe("Khalifa Port to Nhava Sheva");
    expect(ws.getRow(6).getCell(col("Ocean freight (USD)")).value).toBe(1180);       // the current price is prefilled
    expect(ws.getRow(6).getCell(col("Transit offered (days)")).value).toBe(9);
    ws.getRow(6).getCell(col("Fuel surcharge (BAF) (USD)")).value = 260; ws.getRow(6).getCell(col("Origin port charges (USD)")).value = 95;
    ws.getRow(6).getCell(col("Destination port charges (USD)")).value = 110; ws.getRow(6).getCell(col("Documents and other charges (USD)")).value = 0;
    ws.getRow(6).getCell(col("Sailings per week")).value = 6; ws.getRow(6).getCell(col("Rate valid until")).value = new Date("2027-09-30T00:00:00Z");
    ws.getRow(7).getCell(col("Ocean freight (USD)")).value = -5;                    // not allowed
    ws.getRow(8).getCell(col("Ocean freight (USD)")).value = 2350; ws.getRow(8).getCell(col("Transit offered (days)")).value = "soon";
    const filled = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parseLaneSheet("bid.xlsx", filled, form);
    if ("fatal" in r) throw new Error(r.fatal);
    expect(r.prices[grid.lanes[0]!.items.baf!]).toBe("260");
    expect(r.prices[grid.lanes[0]!.items.docs_other!]).toBe("0");                    // zero is allowed for a charge that is included elsewhere
    expect(r.terms["lane:0"]).toMatchObject({ transit_days: "9", sailings_week: "6", valid_until: "2027-09-30" });
    expect(r.errors.map((e) => e.message)).toEqual(expect.arrayContaining(["Lane 2: Ocean freight must be greater than zero (up to 4 decimals).", "Lane 3: check Transit offered (days)."]));
    expect(itemIdsOf(grid).size).toBe(15);
  });
  it("refuses a sheet that is not the lane sheet", async () => {
    const wb = new ExcelJS.Workbook(); wb.addWorksheet("x").addRow(["Line", "Unit price"]);
    const r = await parseLaneSheet("bid.xlsx", Buffer.from(await wb.xlsx.writeBuffer()), form);
    expect(r).toMatchObject({ fatal: "Could not find the Lane column. Use the sheet you downloaded." });
    const wb2 = new ExcelJS.Workbook(); wb2.addWorksheet("x").addRow(["Lane", "Route"]);
    expect(await parseLaneSheet("bid.xlsx", Buffer.from(await wb2.xlsx.writeBuffer()), form)).toMatchObject({ fatal: expect.stringContaining("Could not find the column") });
  });
  it("lets the buyer import lanes in bulk and names the rows that are wrong", async () => {
    const group = FREIGHT.content.pricing.groups[0]!;
    const buf = await groupTemplate(group, [LANES[0]!]);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    ws.addRow(["Khalifa Port", "AEKHL", "Mersin", "TRMER", "40' HC", "CIF", "Polypropylene bags", 120, 14]);
    ws.addRow(["Khalifa Port", "", "", "", "", "", "", "many", ""]);
    const r = await parseGroupSheet("lanes.xlsx", Buffer.from(await wb.xlsx.writeBuffer()), group);
    if ("fatal" in r) throw new Error(r.fatal);
    expect(r.rows.map((x) => x.destination)).toEqual(["Nhava Sheva", "Mersin"]);
    expect(r.rows[1]).toMatchObject({ volume: "120", max_transit: "14", container: "40' HC" });
    expect(r.errors.map((e) => e.message)).toEqual(expect.arrayContaining(["Row 4: enter Destination port.", "Row 4: Containers per year must be a whole number."]));
  });
});

// ---------- with the database ----------
let admin: Client, pool: Pool, W: World;
const buyer = (): Who => ({ tenantId: W.tenantId, userId: W.people.buyer.userId, membershipId: W.people.buyer.membershipId, role: "member" } as Who);
const adminOf = (): Who => ({ tenantId: W.tenantId, userId: W.people.admin.userId, membershipId: W.people.admin.membershipId, role: "admin" } as Who);
const sup = (i: 0 | 1 | 2): SupplierWho => ({ tenantId: W.tenantId, supplierId: W.suppliers[i].id, supplierUserId: W.suppliers[i].supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });
const asSupplier = async <T,>(fn: () => Promise<T>): Promise<T> => { process.env.DB_RUNTIME_ROLE = "app_supplier"; try { return await fn(); } finally { delete process.env.DB_RUNTIME_ROLE; } };
const ver = async (id: string) => (await admin.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;

beforeAll(async () => {
  admin = await adminClient(); pool = makePool(); W = await seedTenant(admin, "freight-lanes");
  await saveProfile(pool, adminOf(), { primaryIndustry: "LOGISTICS", categories: ["FREIGHT"], country: "ae", currency: "USD", timeZone: "Asia/Dubai", defaultLanguage: "en", languages: ["en"] }, 0);
  const a = await activate(pool, adminOf(), ["LOG_FREIGHT_RFQ"], randomUUID(), 0);
  if (!a.ok) throw new Error(a.error);
});
afterAll(async () => { delete process.env.DB_RUNTIME_ROLE; await pool.end(); await admin.end(); });

describe("a freight event made from the template", () => {
  it("uses the lane tender, makes one lot per lane, and rebuilds the lots when the lanes change", async () => {
    const e = await createEventFromTemplate(pool, buyer(), { templateKey: "LOG_FREIGHT_RFQ", title: "Polymer exports 2027", idempotencyKey: randomUUID(), inputs: { groups: { lane: LANES } }, values: { contract_period: "2027" } });
    if (!e.ok) throw new Error(e.error);
    const id = e.event.id;
    expect((await admin.query(`select template_version from sourcing_event where id = $1`, [id])).rows[0].template_version).toBe(3);
    const lots = (await admin.query(`select lot_no, name, template_row from event_lot where event_id = $1 order by lot_no`, [id])).rows;
    expect(lots.map((l) => [l.lot_no, l.name, l.template_row])).toEqual([[1, "Khalifa Port to Nhava Sheva", "lane:0"], [2, "Khalifa Port to Shanghai", "lane:1"], [3, "Khalifa Port to Rotterdam", "lane:2"]]);
    expect((await admin.query(`select count(*)::int n from event_item where event_id = $1 and lot_id is not null`, [id])).rows[0].n).toBe(15);
    // two lanes with the same name still get lots of their own
    const two = await updateTemplateInputs(pool, buyer(), id, { groups: { lane: [LANES[0]!, LANES[0]!] } }, {});
    expect(two).toMatchObject({ ok: true });
    expect((await admin.query(`select name from event_lot where event_id = $1 order by lot_no`, [id])).rows.map((r) => r.name)).toEqual(["Khalifa Port to Nhava Sheva", "Khalifa Port to Nhava Sheva (2)"]);
    const back = await updateTemplateInputs(pool, buyer(), id, { groups: { lane: LANES.slice(0, 2) } }, {});
    expect(back).toMatchObject({ ok: true });
    expect((await admin.query(`select count(*)::int n from event_lot where event_id = $1`, [id])).rows[0].n).toBe(2);
    expect((await admin.query(`select count(*)::int n from event_item where event_id = $1`, [id])).rows[0].n).toBe(10);
  });

  it("is bid on lane by lane, compared side by side and awarded per lane", async () => {
    const e = await createEventFromTemplate(pool, buyer(), { templateKey: "LOG_FREIGHT_RFQ", title: "Polymer exports lanes", idempotencyKey: randomUUID(), inputs: { groups: { lane: LANES } }, values: { contract_period: "2027" } });
    if (!e.ok) throw new Error(e.error);
    const id = e.event.id;
    await admin.query(`update sourcing_event set state = 'published', closes_at = now() + interval '1 day' where id = $1`, [id]);
    for (const i of [0, 1] as const) await admin.query(`insert into invitation (tenant_id, event_id, supplier_id, supplier_user_id, token_hash) values ($1,$2,$3,$4,$5)`, [W.tenantId, id, W.suppliers[i].id, W.suppliers[i].supplierUserId, randomUUID()]);

    const form = (await asSupplier(() => getBidForm(pool, sup(0), id)))!;
    const grid = form.laneGrid!;
    expect(grid.lanes.map((l) => l.name)).toEqual(["Khalifa Port to Nhava Sheva", "Khalifa Port to Shanghai", "Khalifa Port to Rotterdam"]);
    expect(form.lots).toHaveLength(3);
    const priceLane = (n: number, v: number[]) => Object.fromEntries(grid.components.map((c, k) => [grid.lanes[n]!.items[c.lineKey]!, String(v[k])]));
    const gates = Object.fromEntries(form.gates.map((g) => [g, true]));
    // answer every question the template makes mandatory
    const answers: Answers = {};
    for (const a of form.questionnaire!.asks) if (isVisible(a, answers) && isRequired(a, answers)) answers[a.key] = a.type === "boolean" || a.type === "yesno" ? true : a.type === "single" ? a.options![0]!.key : a.type === "integer" || a.type === "decimal" || a.type === "money" ? "30" : a.type === "date" ? "2027-01-31" : "Yes, as described.";
    const base = { technicalText: "We run weekly services on all three lanes.", gates, answers };
    const A = { ...priceLane(0, [1180, 260, 95, 110, 70]), ...priceLane(1, [1420, 310, 95, 140, 70]), ...priceLane(2, [2350, 380, 95, 220, 85]) };
    // a lane with a missing component is refused (lot rule), then a lane with no transit time is refused
    const half = { ...A }; delete half[grid.lanes[1]!.items.baf!];
    expect(await asSupplier(() => submitBidForm(pool, sup(0), id, { ...base, prices: half, laneTerms: {} }))).toMatchObject({ ok: false, error: expect.stringContaining("lot 2") });
    expect(await asSupplier(() => submitBidForm(pool, sup(0), id, { ...base, prices: A, laneTerms: {} }))).toMatchObject({ ok: false, error: "Lane 1: enter Transit offered (days)." });
    const termsA = { "lane:0": { transit_days: "9", sailings_week: "6", free_days: "7", valid_until: "2027-09-30" }, "lane:1": { transit_days: "24" }, "lane:2": { transit_days: "27" } };
    const doneA = await asSupplier(() => submitBidForm(pool, sup(0), id, { ...base, prices: A, laneTerms: termsA }));
    expect(doneA).toMatchObject({ ok: true, total: String(1715 * 320 + 2035 * 260 + 3130 * 150) + ".00" });
    // supplier 2 bids lanes 1 and 2 only
    const B = { ...priceLane(0, [1000, 100, 80, 100, 50]), ...priceLane(1, [1350, 280, 90, 130, 60]) };
    expect(await asSupplier(() => submitBidForm(pool, sup(1), id, { ...base, prices: B, laneTerms: { "lane:0": { transit_days: "12" }, "lane:1": { transit_days: "20" }, "lane:2": { transit_days: "99" } } }))).toMatchObject({ ok: true });
    // what is stored comes back: terms for lanes with a bid only, and the receipt code covers them
    const after = (await asSupplier(() => getBidForm(pool, sup(1), id)))!;
    expect(Object.keys(after.laneTerms)).toEqual(["lane:0", "lane:1"]);
    const afterA = (await asSupplier(() => getBidForm(pool, sup(0), id)))!;
    expect(afterA.laneTerms["lane:0"]).toEqual(termsA["lane:0"]);
    const code = afterA.fingerprint;
    expect(code).toBeTruthy();
    expect(await asSupplier(() => submitBidForm(pool, sup(0), id, { ...base, prices: A, laneTerms: { ...termsA, "lane:0": { ...termsA["lane:0"], free_days: "10" } } }))).toMatchObject({ ok: true });
    expect((await asSupplier(() => getBidForm(pool, sup(0), id)))!.fingerprint).not.toBe(code);

    // move to the commercial stage the way the other tests do, then look at the buyer's comparison
    await admin.query(`update sourcing_event set state = 'technical_approved', envelope1_opened_at = now(), closes_at = now() - interval '1 day' where id = $1`, [id]);
    for (const [who, role] of [["buyer", "buyer"], ["witness", "witness"], ["comm", "comm_evaluator"], ["awardApprover", "award_approver"]] as const)
      await admin.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,$4)`, [W.tenantId, id, W.people[who].membershipId, role]);
    for (const i of [0, 1]) {
      await admin.query(`insert into tech_result (tenant_id, event_id, supplier_id, total, qualified) values ($1,$2,$3,80,true)`, [W.tenantId, id, W.suppliers[i]!.id]);
      await admin.query(`insert into qualified_bidder (tenant_id, event_id, supplier_id) values ($1,$2,$3)`, [W.tenantId, id, W.suppliers[i]!.id]);
    }
    expect(await openCommercialConfirmed(pool, buyer(), id, await ver(id), W.people.witness.membershipId)).toMatchObject({ ok: true });
    const view = (await getCommercialView(pool, buyer(), id))!;
    const m = view.comparison!.laneMatrix!;
    expect(m.rows).toHaveLength(3);
    expect(m.rows.map((r) => r.lowest)).toEqual([W.suppliers[1]!.id, W.suppliers[1]!.id, W.suppliers[0]!.id]);    // B is cheaper on lanes 1 and 2; only A bid lane 3
    expect(m.rows[2]!.cells[W.suppliers[1]!.id]!.priced).toBe(false);
    expect(m.rows[0]!.cells[W.suppliers[0]!.id]).toMatchObject({ allIn: "1715.00", meets: true });
    expect(m.rows[0]!.cells[W.suppliers[1]!.id]).toMatchObject({ meets: false });                                 // 12 days against a limit of 10
    expect(m.bestSingle).toMatchObject({ supplierId: W.suppliers[0]!.id });
    expect(m.byLane.carriers).toBe(2);
    expect(Number(m.saving)).toBeGreaterThan(0);
    expect(view.comparison!.lots).toHaveLength(3);                                                                 // each lane is ranked, and can be awarded, on its own
    expect(view.comparison!.lots![2]!.rows).toHaveLength(1);
  });
});
