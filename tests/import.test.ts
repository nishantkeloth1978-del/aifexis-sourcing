import ExcelJS from "exceljs";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEvent, duplicateEvent, getEvent, importItems, type Who } from "@/events/service";
import { itemsTemplate, parseItemsSheet } from "@/events/sheet";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (): Who => ({ tenantId: X.tenantId, userId: X.people.admin.userId, membershipId: X.people.admin.membershipId, role: "admin" } as Who);
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "imp"); });
afterAll(async () => { await pool.end(); await admin.end(); });

async function xlsx(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("S"); rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("reading a sheet", () => {
  it("reads the downloadable template back", async () => {
    const r = await parseItemsSheet("t.xlsx", await itemsTemplate());
    expect(r).toMatchObject({ total: 2, errors: [] });
    if ("rows" in r) expect(r.rows.map((x) => [x.quantity, x.unit, x.blockType])).toEqual([["4", "EA", "UNIT_PRICE"], ["1", "LS", "LUMP_SUM"]]);
  });
  it("finds the header below a title, skips blanks, and reports bad rows by row number", async () => {
    const buf = await xlsx([["Pump tender"], [], ["Item", "Qty", "UoM"], ["Pump", 2, "ea"], ["", "", ""], ["Valve", "x", "EA"], ["Seal kit", 3.5, ""]]);
    const r = await parseItemsSheet("a.xlsx", buf);
    expect(r).toMatchObject({ total: 3 });
    if ("rows" in r) { expect(r.rows).toHaveLength(1); expect(r.rows[0]).toMatchObject({ description: "Pump", unit: "EA" }); expect(r.errors.map((e) => e.row)).toEqual([6, 7]); }
  });
  it("reads CSV with Arabic text, and rejects other files and missing headers", async () => {
    const r = await parseItemsSheet("a.csv", Buffer.from("﻿Description,Quantity,Unit\nمضخة,2,EA\n"));
    expect(r).toMatchObject({ total: 1, errors: [] });
    if ("rows" in r) expect(r.rows[0]!.description).toBe("مضخة");
    expect(await parseItemsSheet("a.pdf", Buffer.from("x"))).toHaveProperty("fatal");
    expect(await parseItemsSheet("a.csv", Buffer.from("foo,bar\n1,2\n"))).toHaveProperty("fatal");
    expect(await parseItemsSheet("a.xlsx", Buffer.from("not a zip"))).toHaveProperty("fatal");
  });
});

describe("import and duplicate", () => {
  it("imports all or nothing into a draft, and copies a draft with its lines", async () => {
    const e = await createEvent(pool, who(), { title: "Pumps" }); if (!e.ok) throw new Error("setup");
    const id = e.event.id;
    const rows = [{ description: "Pump", quantity: "2", unit: "ea", blockType: "UNIT_PRICE" as const }, { description: "Install", quantity: "1", unit: "LS", blockType: "LUMP_SUM" as const }];
    expect(await importItems(pool, who(), id, [...rows, { description: "Bad", quantity: "0", unit: "EA", blockType: "UNIT_PRICE" }])).toMatchObject({ ok: false });
    expect((await getEvent(pool, who(), id))!.items).toHaveLength(0);
    expect(await importItems(pool, who(), id, rows)).toMatchObject({ ok: true, added: 2 });
    expect((await getEvent(pool, who(), id))!.items.map((i) => [i.lineNo, i.unit, i.blockType])).toEqual([[1, "EA", "UNIT_PRICE"], [2, "LS", "LUMP_SUM"]]);
    const copy = await duplicateEvent(pool, who(), id); if (!copy.ok) throw new Error("dup");
    const c2 = (await getEvent(pool, who(), copy.id))!;
    expect(c2).toMatchObject({ state: "draft", title: "Pumps (copy)", closesAt: null }); expect(c2.items).toHaveLength(2); expect(c2.ref).not.toBe(e.event.ref);
    await admin.query(`update sourcing_event set state = 'published' where id = $1`, [id]);
    expect(await importItems(pool, who(), id, rows)).toMatchObject({ ok: false });
  });
});

describe("import quality and modes", () => {
  it("reads SAP-style headers, extra detail columns, heading rows, and lists unmapped columns", async () => {
    const buf = await xlsx([["Short text", "PO quantity", "Base unit of measure", "Material group", "Delivery date", "Long text", "Cost centre"], ["Section A: pumps"], ["Pump", 2, "EA", "MECH", "2026-12-01", "API 610", "CC1"], ["Bad date", 1, "EA", "", "soon", "", ""]]);
    const r = await parseItemsSheet("s.xlsx", buf);
    if (!("rows" in r)) throw new Error("fatal");
    expect(r.sections).toBe(1);
    expect(r.unmapped).toEqual(["Cost centre"]);
    expect(r.rows[0]).toMatchObject({ materialGroup: "MECH", requiredDate: "2026-12-01", specification: "API 610" });
    expect(r.errors).toHaveLength(1);
  });
  it("appends, merges and replaces", async () => {
    const e = await createEvent(pool, who(), { title: "Modes" }); if (!e.ok) throw new Error("setup");
    const id = e.event.id;
    const row = (d: string, q: string, code?: string) => ({ description: d, quantity: q, unit: "EA", blockType: "UNIT_PRICE" as const, code });
    expect(await importItems(pool, who(), id, [row("Pump", "2", "P1"), row("Valve", "4")])).toMatchObject({ ok: true, added: 2 });
    expect(await importItems(pool, who(), id, [{ ...row("Pump new text", "9", "P1"), targetPrice: "12.5" }, row("valve", "5"), row("Seal", "1")], "merge")).toMatchObject({ ok: true, added: 1, updated: 2 });
    const items = (await getEvent(pool, who(), id))!.items;
    expect(items.map((i) => [i.description, i.quantity, i.targetPrice])).toEqual([["Pump", "9.000", "12.5000"], ["Valve", "5.000", null], ["Seal", "1.000", null]]);
    expect(await importItems(pool, who(), id, [row("Only", "1")], "replace")).toMatchObject({ ok: true, added: 1, removed: 3 });
    expect((await getEvent(pool, who(), id))!.items.map((i) => i.description)).toEqual(["Only"]);
    expect(await importItems(pool, who(), id, [row("X", "1")], "bogus" as never)).toMatchObject({ ok: false });
  });
});

describe("sections in the import", () => {
  it("turns numbered heading rows into section paths, and keeps them through merge and copy", async () => {
    const buf = await xlsx([["Description", "Quantity", "Unit"], ["1 Civil works"], ["1.1 Foundations"], ["Concrete C30", 10, "M3"], ["1.2 Slabs"], ["Rebar", 5, "T"], ["2 Mechanical"], ["Pump", 1, "EA"]]);
    const r = await parseItemsSheet("b.xlsx", buf);
    if (!("rows" in r)) throw new Error("fatal");
    expect(r.sections).toBe(4);
    expect(r.rows.map((x) => [x.description, x.section])).toEqual([["Concrete C30", "1 Civil works > 1.1 Foundations"], ["Rebar", "1 Civil works > 1.2 Slabs"], ["Pump", "2 Mechanical"]]);
    const e = await createEvent(pool, who(), { title: "BOQ" }); if (!e.ok) throw new Error("setup");
    expect(await importItems(pool, who(), e.event.id, r.rows)).toMatchObject({ ok: true, added: 3 });
    const items = (await getEvent(pool, who(), e.event.id))!.items;
    expect(items.map((i) => i.section)).toEqual(["1 Civil works > 1.1 Foundations", "1 Civil works > 1.2 Slabs", "2 Mechanical"]);
    const copy = await duplicateEvent(pool, who(), e.event.id); if (!copy.ok) throw new Error("dup");
    expect((await getEvent(pool, who(), copy.id))!.items.map((i) => i.section)).toEqual(items.map((i) => i.section));
  });
  it("reads a Section column", async () => {
    const r = await parseItemsSheet("c.xlsx", await xlsx([["Section", "Description", "Quantity", "Unit"], ["Piping", "Pipe 4in", 20, "M"]]));
    if (!("rows" in r)) throw new Error("fatal");
    expect(r.rows[0]!.section).toBe("Piping");
  });
});
