import ExcelJS from "exceljs";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCatalogItem, importCatalog, listCatalog, updateCatalogItem } from "@/catalog/service";
import { catalogTemplate, parseCatalogSheet } from "@/catalog/sheet";
import { fillFromCatalog } from "@/catalog/fill";
import { withTenant } from "@/authz";
import { createEvent, duplicateEvent, getEvent, importItems, saveAsTemplate, createFromTemplate, addItem, type Who } from "@/events/service";
import { itemsTemplate, parseItemsSheet } from "@/events/sheet";
import { importSuppliers, setSupplierStatus, supplierProfile, updateSupplier } from "@/suppliers/master";
import { parseSuppliersSheet, suppliersTemplate } from "@/suppliers/sheet";
import { createSupplier, inviteSupplier, listSuppliers } from "@/suppliers/service";
import { previewPayload } from "@/handover/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World, Y: World;
const as = (W: World, p: keyof World["people"], role = "member"): Who => ({ tenantId: W.tenantId, userId: W.people[p].userId, membershipId: W.people[p].membershipId, role } as Who);
const who = (p: keyof World["people"] = "buyer", role = "member") => as(X, p, role);
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "mst"); Y = await seedTenant(admin, "mst-other"); });
afterAll(async () => { await pool.end(); await admin.end(); });

async function xlsx(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("S"); rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("item catalogue", () => {
  it("adds, rejects duplicate codes (any case), edits, deactivates, and is private to the tenant", async () => {
    const a = await addCatalogItem(pool, who(), { code: " pmp-0001 ", description: "Centrifugal pump", unit: "ea", category: "Pumps" });
    expect(a).toMatchObject({ ok: true, item: { code: "PMP-0001", unit: "EA", active: true } }); if (!a.ok) return;
    expect(await addCatalogItem(pool, who(), { code: "Pmp-0001", description: "Other", unit: "EA" })).toMatchObject({ ok: false, error: "An item with that code already exists." });
    expect(await addCatalogItem(pool, who("auditor", "auditor"), { code: "X1", description: "x", unit: "EA" })).toMatchObject({ ok: false });
    expect(await addCatalogItem(pool, who(), { code: "", description: "x", unit: "EA" })).toMatchObject({ ok: false });
    expect(await updateCatalogItem(pool, who(), a.item.id, { code: "PMP-0001", description: "Centrifugal pump API 610", unit: "EA", category: "Pumps", active: false })).toMatchObject({ ok: true, item: { active: false } });
    expect((await listCatalog(pool, who(), { activeOnly: true })).map((i) => i.code)).not.toContain("PMP-0001");
    expect((await listCatalog(pool, who(), { q: "api 610" })).map((i) => i.code)).toContain("PMP-0001");
    expect(await listCatalog(pool, as(Y, "buyer"))).toEqual([]);
    expect(await updateCatalogItem(pool, as(Y, "buyer"), a.item.id, { code: "HACK", description: "x", unit: "EA" })).toMatchObject({ ok: false });
  });
  it("imports new codes and updates existing ones, all or nothing", async () => {
    await addCatalogItem(pool, who(), { code: "VLV-1", description: "Old valve", unit: "EA" });
    expect(await importCatalog(pool, who(), [{ code: "VLV-1", description: "Gate valve", unit: "EA" }, { code: "VLV-2", description: "Ball valve", unit: "EA", category: "Valves" }])).toMatchObject({ ok: true, added: 1, updated: 1 });
    expect((await listCatalog(pool, who(), { q: "vlv-1" }))[0]).toMatchObject({ description: "Gate valve" });
    expect(await importCatalog(pool, who(), [{ code: "OK-1", description: "ok", unit: "EA" }, { code: "BAD", description: "", unit: "EA" }])).toMatchObject({ ok: false });
    expect(await listCatalog(pool, who(), { q: "ok-1" })).toHaveLength(0);
    expect(await importCatalog(pool, who(), [{ code: "D", description: "a", unit: "EA" }, { code: "d", description: "b", unit: "EA" }])).toMatchObject({ ok: false });
  });
  it("reads the catalogue template and a sheet with errors", async () => {
    expect(await parseCatalogSheet("t.xlsx", await catalogTemplate())).toMatchObject({ total: 2, errors: [] });
    const r = await parseCatalogSheet("c.xlsx", await xlsx([["Material", "Item", "UoM"], ["A-1", "First", "EA"], ["A-1", "Again", "EA"], ["", "No code", "EA"]]));
    expect(r).toMatchObject({ total: 3 });
    if ("rows" in r) { expect(r.rows).toHaveLength(1); expect(r.errors.map((e) => e.row)).toEqual([3, 4]); }
  });
});

describe("item codes on event lines", () => {
  it("keeps the code on added, imported, duplicated and templated lines, and fills blanks from the catalogue", async () => {
    await addCatalogItem(pool, who(), { code: "SRV-10", description: "Commissioning service", unit: "ls" });
    const e = await createEvent(pool, who(), { title: "Codes" }); if (!e.ok) throw new Error("setup");
    const id = e.event.id;
    expect(await addItem(pool, who(), id, { description: "Pump", quantity: "2", unit: "EA", code: " pmp-0001 " })).toMatchObject({ ok: true, item: { code: "PMP-0001" } });
    expect(await addItem(pool, who(), id, { description: "Pump", quantity: "2", unit: "EA", code: "x".repeat(41) })).toMatchObject({ ok: false });
    // a sheet row with only a code and a quantity
    const sheet = await parseItemsSheet("i.xlsx", await xlsx([["Code", "Quantity"], ["srv-10", 1], ["NOPE-1", 1]]));
    expect(sheet).toMatchObject({ total: 2, errors: [] }); if (!("rows" in sheet)) return;
    const filled = await withTenant(pool, X.tenantId, (c) => fillFromCatalog(c, sheet.rows));
    expect(filled.unknown.map((u) => u.code)).toEqual(["NOPE-1"]);
    expect(filled.rows[0]).toMatchObject({ description: "Commissioning service", unit: "LS", code: "SRV-10" });
    expect(await importItems(pool, who(), id, [sheet.rows[1]!])).toMatchObject({ ok: false });           // unknown code stays blank, so it is refused
    expect(await importItems(pool, who(), id, [sheet.rows[0]!])).toMatchObject({ ok: true, added: 1 });   // server fills from the catalogue
    const items = (await getEvent(pool, who(), id))!.items;
    expect(items.map((i) => [i.code, i.description, i.unit])).toEqual([["PMP-0001", "Pump", "EA"], ["SRV-10", "Commissioning service", "LS"]]);
    const copy = await duplicateEvent(pool, who(), id); if (!copy.ok) throw new Error("dup");
    expect((await getEvent(pool, who(), copy.id))!.items.map((i) => i.code)).toEqual(["PMP-0001", "SRV-10"]);
    const tpl = await saveAsTemplate(pool, who(), id, "With codes"); if (!tpl.ok) throw new Error("tpl");
    const fromTpl = await createFromTemplate(pool, who(), tpl.id, { title: "From template" }); if (!fromTpl.ok) throw new Error("fromtpl");
    expect((await getEvent(pool, who(), fromTpl.event.id))!.items.map((i) => i.code)).toEqual(["PMP-0001", "SRV-10"]);
  });
  it("has a Code column in the items template", async () => {
    const r = await parseItemsSheet("t.xlsx", await itemsTemplate());
    expect(r).toMatchObject({ total: 2, errors: [] });
    if ("rows" in r) expect(r.rows.map((x) => x.code)).toEqual(["PMP-0001", undefined]);
  });
});

describe("supplier master data", () => {
  it("edits the profile, enforces unique names and vendor codes, and blocks new invitations", async () => {
    const a = await createSupplier(pool, who(), { name: "Alpha Co", contactEmail: "a@alpha.example" });
    const b = await createSupplier(pool, who(), { name: "Beta Co", contactEmail: "b@beta.example" });
    if (!a.ok || !b.ok) throw new Error("setup");
    expect(await updateSupplier(pool, who(), a.supplier.id, { name: "Alpha Co", vendorCode: "100234", country: "UAE", category: "Pumps", taxNo: "TRN1" })).toMatchObject({ ok: true, supplier: { vendorCode: "100234", country: "UAE" } });
    expect(await updateSupplier(pool, who(), b.supplier.id, { name: "Beta Co", vendorCode: "100234" })).toMatchObject({ ok: false, error: "Another supplier already has that vendor code." });
    expect(await updateSupplier(pool, who(), b.supplier.id, { name: "alpha co" })).toMatchObject({ ok: false });
    expect(await updateSupplier(pool, who("auditor", "auditor"), a.supplier.id, { name: "Alpha Co" })).toMatchObject({ ok: false });
    expect(await updateSupplier(pool, as(Y, "buyer"), a.supplier.id, { name: "Hijack" })).toMatchObject({ ok: false });

    const ev = await makeEvent(admin, X, "published");
    expect(await setSupplierStatus(pool, who(), a.supplier.id, "blocked")).toMatchObject({ ok: true });
    expect(await inviteSupplier(pool, as(X, "admin", "admin"), ev.id, a.supplier.id)).toMatchObject({ ok: false, error: "This supplier is blocked and cannot be invited." });
    expect((await listSuppliers(pool, who())).find((s) => s.id === a.supplier.id)).toMatchObject({ status: "blocked" });
    expect(await setSupplierStatus(pool, who(), a.supplier.id, "active")).toMatchObject({ ok: true });
    expect(await inviteSupplier(pool, as(X, "admin", "admin"), ev.id, a.supplier.id)).toMatchObject({ ok: true });
  });
  it("imports suppliers, skipping duplicates and staff emails, and shows event history", async () => {
    const staffEmail = (await admin.query(`select email from app_user where id = $1`, [X.people.buyer.userId])).rows[0].email as string;
    const r = await importSuppliers(pool, who(), [
      { name: "Gamma Ltd", contactEmail: "g@gamma.example", vendorCode: "G-1", country: "Oman" },
      { name: "gamma ltd", contactEmail: "g2@gamma.example" },
      { name: "Delta Ltd", contactEmail: "d@delta.example", vendorCode: "G-1" },
      { name: "Staff Co", contactEmail: staffEmail },
      { name: "Epsilon", contactEmail: "e@eps.example" },
    ]);
    expect(r).toMatchObject({ ok: true, added: 2 });
    if (r.ok) expect(r.skipped.map((s) => s.row)).toEqual([2, 3, 4]);
    expect(await importSuppliers(pool, who(), [{ name: "X", contactEmail: "x@y.example" }, { name: "Bad", contactEmail: "nope" }])).toMatchObject({ ok: false });

    const parsed = await parseSuppliersSheet("s.xlsx", await suppliersTemplate());
    expect(parsed).toMatchObject({ total: 1, errors: [] });
    const bad = await parseSuppliersSheet("s.xlsx", await xlsx([["Supplier", "Email", "Vendor No"], ["Zeta", "z@zeta.example", "Z1"], ["NoMail", "", ""]]));
    if ("rows" in bad) { expect(bad.rows).toHaveLength(1); expect(bad.errors.map((e) => e.row)).toEqual([3]); }

    const sup = (await listSuppliers(pool, who())).find((s) => s.name === "Epsilon")!;
    const ev = await makeEvent(admin, X, "published");
    expect(await inviteSupplier(pool, as(X, "admin", "admin"), ev.id, sup.id)).toMatchObject({ ok: true });
    const p = await supplierProfile(pool, who(), sup.id);
    expect(p).toMatchObject({ bids: 0, wins: 0 }); expect(p!.history[0]).toMatchObject({ eventId: ev.id, bid: false, outcome: null });
    expect(await supplierProfile(pool, as(Y, "buyer"), sup.id)).toBeNull();
  });
});

describe("handover carries the codes", () => {
  it("adds the vendor code and material codes to the payload when held", async () => {
    const e = await makeEvent(admin, X, "draft", { withBids: true });
    await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, item_code) values ($1,$2,1,'Pump','2','EA','PMP-0001')`, [X.tenantId, e.id]);
    await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit) values ($1,$2,2,'Other','1','EA')`, [X.tenantId, e.id]);
    await admin.query(`update sourcing_event set state = 'awarded', currency = 'AED' where id = $1`, [e.id]);
    const win = X.suppliers[0].id;
    await admin.query(`update supplier_org set vendor_code = 'V-900' where id = $1`, [win]);
    const rev = (await admin.query(`select id from bid_revision where event_id = $1 and supplier_id = $2`, [e.id, win])).rows[0].id;
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D7','price_lines',$3)`, [X.tenantId, rev,
      JSON.stringify({ lines: [{ lineNo: 1, quantity: "2", unitPrice: "10", amount: "20.00" }, { lineNo: 2, quantity: "1", unitPrice: "5", amount: "5.00" }], total: "25.00" })]);
    await admin.query(`insert into recommendation (tenant_id, event_id, supplier_id, note, created_by) values ($1,$2,$3,'Lowest compliant bid.',$4)`, [X.tenantId, e.id, win, X.people.buyer.membershipId]);
    const p = await previewPayload(pool, who("buyer"), e.id, "SAP");
    if (!p.ok) throw new Error(p.error);
    expect(p.payload.vendor).toMatchObject({ vendorCode: "V-900" });
    expect(p.payload.items.map((i) => i.materialCode)).toEqual(["PMP-0001", undefined]);
  });
});
