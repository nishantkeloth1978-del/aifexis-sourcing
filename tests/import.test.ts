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
