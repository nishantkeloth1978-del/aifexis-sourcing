import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBidForm, submitBidForm } from "@/bids/service";
import { parsePriceSheet, priceSheet } from "@/bids/sheet";
import { saveConfig, DEFAULT_CONFIG } from "@/config/service";
import { addItem, createEvent, createFromTemplate, deleteTemplate, listTemplates, saveAsTemplate, type Who } from "@/events/service";
import type { SupplierWho } from "@/suppliers/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World, Y: World;
const who = (w: World, role = "admin"): Who => ({ tenantId: w.tenantId, userId: w.people.admin.userId, membershipId: w.people.admin.membershipId, role });
const sw = (w: World, i: 0 | 1 | 2): SupplierWho => ({ tenantId: w.tenantId, supplierId: w.suppliers[i].id, supplierUserId: w.suppliers[i].supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });

beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "pw1"); Y = await seedTenant(admin, "pw2"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("event templates", () => {
  it("saves, lists, starts a new event from a template, and stays inside the tenant", async () => {
    const e = await createEvent(pool, who(X), { title: "Pump set", ownerDept: "Procurement" });
    if (!e.ok) throw new Error("setup");
    expect(await saveAsTemplate(pool, who(X), e.event.id, "Pumps")).toMatchObject({ ok: false });     // no lines yet
    await addItem(pool, who(X), e.event.id, { description: "Pump A", quantity: "2", unit: "ea" });
    await addItem(pool, who(X), e.event.id, { description: "Pump B", quantity: "1.5", unit: "ea" });
    expect(await saveAsTemplate(pool, who(X, "viewer"), e.event.id, "Pumps")).toMatchObject({ ok: false });
    expect(await saveAsTemplate(pool, who(X), e.event.id, "x")).toMatchObject({ ok: false });
    const t = await saveAsTemplate(pool, who(X), e.event.id, "Pumps");
    if (!t.ok) throw new Error(t.error);
    const list = await listTemplates(pool, who(X));
    expect(list).toHaveLength(1); expect(list[0]).toMatchObject({ name: "Pumps", lineCount: 2, ownerDept: "Procurement" });
    expect(await listTemplates(pool, who(Y))).toHaveLength(0);
    const n = await createFromTemplate(pool, who(X), t.id, { title: "Pumps for plant 2" });
    if (!n.ok) throw new Error(n.error);
    expect(n.event).toMatchObject({ state: "draft", ownerDept: "Procurement" });
    const items = (await admin.query(`select line_no, description, quantity::text as q from event_item where event_id = $1 order by line_no`, [n.event.id])).rows;
    expect(items.map((r) => r.description)).toEqual(["Pump A", "Pump B"]); expect(items[1].q).toBe("1.500");
    expect(await createFromTemplate(pool, who(Y), t.id, { title: "Steal it" })).toMatchObject({ ok: false });
    expect(await deleteTemplate(pool, who(X, "member"), t.id)).toMatchObject({ ok: false });
    expect(await deleteTemplate(pool, who(X), t.id)).toMatchObject({ ok: true });
  });
});

describe("mandatory declarations, price sheet and receipt", () => {
  it("validates declarations in the configuration", async () => {
    const base = { ...DEFAULT_CONFIG };
    expect(await saveConfig(pool, who(X), { ...base, gates: ["ab"] })).toMatchObject({ ok: false });
    expect(await saveConfig(pool, who(X), { ...base, gates: ["Valid licence", "valid licence"] })).toMatchObject({ ok: false });
    expect(await saveConfig(pool, who(X), { ...base, gates: ["Valid trade licence", "No sanctions"] })).toMatchObject({ ok: true });
  });
  it("requires an answer to every declaration, round-trips the price sheet and issues a stable receipt", async () => {
    const ev = (await admin.query(`insert into sourcing_event (tenant_id, title, state, ref, currency, closes_at) values ($1,'Pumps','draft',$2,'AED',$3) returning id`,
      [X.tenantId, "EV-" + randomUUID().slice(0, 8), new Date(Date.now() + 3600_000).toISOString()])).rows[0].id as string;
    const ids: string[] = [];
    for (const [n, q, t] of [[1, "10", "UNIT_PRICE"], [2, "1", "LUMP_SUM"]] as const)
      ids.push((await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type) values ($1,$2,$3,'Item',$4,'ea',$5) returning id`, [X.tenantId, ev, n, q, t])).rows[0].id);
    await admin.query(`update sourcing_event set state = 'published' where id = $1`, [ev]);
    await admin.query(`insert into invitation (tenant_id, event_id, supplier_id, supplier_user_id, token_hash) values ($1,$2,$3,$4,$5)`, [X.tenantId, ev, X.suppliers[0].id, X.suppliers[0].supplierUserId, randomUUID()]);
    const form0 = (await getBidForm(pool, sw(X, 0), ev))!;
    expect(form0.gates).toEqual(["Valid trade licence", "No sanctions"]);
    expect(form0.fingerprint).toBeNull();

    // price sheet: download, fill, upload
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await priceSheet(form0)) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!; ws.getRow(2).getCell(6).value = 12.5; ws.getRow(3).getCell(6).value = 1000.1;
    const filled = Buffer.from(await wb.xlsx.writeBuffer());
    const parsed = await parsePriceSheet("p.xlsx", filled, form0.items);
    expect(parsed).toMatchObject({ filled: 2, errors: [] });
    if ("fatal" in parsed) return;
    expect(parsed.prices).toEqual({ [ids[0]!]: "12.5", [ids[1]!]: "1000.1" });
    ws.getRow(2).getCell(6).value = -3; ws.getRow(3).getCell(1).value = 99;
    const bad = await parsePriceSheet("p.xlsx", Buffer.from(await wb.xlsx.writeBuffer()), form0.items);
    expect("fatal" in bad ? 0 : bad.errors.length).toBe(2);
    expect(await parsePriceSheet("p.csv", filled, form0.items)).toHaveProperty("fatal");

    const text = "We comply with the whole specification.";
    expect(await submitBidForm(pool, sw(X, 0), ev, { prices: parsed.prices, technicalText: text })).toMatchObject({ ok: false });
    expect(await submitBidForm(pool, sw(X, 0), ev, { prices: parsed.prices, technicalText: text, gates: { "Valid trade licence": true } })).toMatchObject({ ok: false });
    const gates = { "Valid trade licence": true, "No sanctions": false };
    expect(await submitBidForm(pool, sw(X, 0), ev, { prices: parsed.prices, technicalText: text, gates })).toMatchObject({ ok: true, revisionNo: 1 });
    const a = (await getBidForm(pool, sw(X, 0), ev))!;
    expect(a.gateAnswers).toEqual(gates); expect(a.submittedAt).not.toBeNull(); expect(a.fingerprint).toMatch(/^[0-9A-F]{16}$/);
    expect((await getBidForm(pool, sw(X, 0), ev))!.fingerprint).toBe(a.fingerprint);
    await submitBidForm(pool, sw(X, 0), ev, { prices: { ...parsed.prices, [ids[0]!]: "13" }, technicalText: text, gates });
    expect((await getBidForm(pool, sw(X, 0), ev))!.fingerprint).not.toBe(a.fingerprint);
  });
});
