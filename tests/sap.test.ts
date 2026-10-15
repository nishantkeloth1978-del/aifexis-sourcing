import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkMapping, getMapping, saveMapping, sapCsv, toSapPo, SAP_NO_PERM, type SapMapping } from "@/handover/sap";
import { previewSap } from "@/handover/sap-service";
import type { HandoverPayload } from "@/handover/service";
import { createClient } from "@/integrations/service";
import { authenticate, getAwardApi } from "@/integrations/api";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World, Y: World;
const who = (w: World, p: keyof World["people"], role = "member", perms?: string[]): Who => ({ tenantId: w.tenantId, userId: w.people[p].userId, membershipId: w.people[p].membershipId, role, ...(perms ? { perms } : {}) } as Who);
beforeAll(async () => { process.env.SIGNING_SECRET = "t".repeat(40); admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "sap-x"); Y = await seedTenant(admin, "sap-y"); });
afterAll(async () => { await pool.end(); await admin.end(); });

const MAP: SapMapping = { companyCode: "1000", purchOrg: "1000", purchGroup: "A01", plant: "1100", docType: "NB", uomMap: { PAIR: "PR", EA: "EA" } };
const pay = (patch: Partial<HandoverPayload> = {}, item: object = {}): HandoverPayload => ({ schema: "aifexis.award.v1", target: "SAP", eventRef: "EV-2026-001", title: "Gloves", currency: "AED", awardedAt: "2026-10-01T08:00:00.000Z",
  vendor: { name: "Acme", contactEmail: null, vendorCode: "0000100234" }, items: [{ lineNo: 1, materialCode: "MAT-1", description: "Nitrile gloves", quantity: "200", unit: "PAIR", unitPrice: "3.5", netAmount: "700.00", ...item }], totalNet: "700.00", recommendation: "x", ...patch });

describe("mapping rules", () => {
  it("cleans and checks the mapping", () => {
    expect(checkMapping({ companyCode: "1000", purchOrg: "po1", purchGroup: "a01", docType: "", uomMap: { pair: "pr" } })).toMatchObject({ ok: true, value: { purchOrg: "PO1", purchGroup: "A01", docType: "NB", uomMap: { PAIR: "PR" } } });
    for (const bad of [{}, { companyCode: "12345", purchOrg: "1", purchGroup: "A" }, { companyCode: "1", purchOrg: "1", purchGroup: "ABCD" }, { companyCode: "1", purchOrg: "1", purchGroup: "A", plant: "toolong" },
      { companyCode: "1", purchOrg: "1", purchGroup: "A", uomMap: { EA: "TOOLONG" } }, { companyCode: "1", purchOrg: "1", purchGroup: "A", uomMap: [] }, { companyCode: "1;", purchOrg: "1", purchGroup: "A" }])
      expect(checkMapping(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
  });
  it("turns an award into a purchase order with mapped codes and units", () => {
    const r = toSapPo(pay(), MAP);
    expect(r).toMatchObject({ ok: true, warnings: [], document: { PurchaseOrderType: "NB", CompanyCode: "1000", PurchasingGroup: "A01", Supplier: "0000100234", DocumentCurrency: "AED", PurchaseOrderDate: "2026-10-01", CorrespncExternalReference: "EV-2026-001" } });
    if (r.ok) expect(r.document.to_PurchaseOrderItem[0]).toEqual({ PurchaseOrderItem: "00010", Material: "MAT-1", PurchaseOrderItemText: "Nitrile gloves", Plant: "1100", OrderQuantity: "200", PurchaseOrderQuantityUnit: "PR", NetPriceAmount: "3.5", NetPriceQuantity: "1", DocumentCurrency: "AED" });
  });
  it("names every missing piece instead of guessing", () => {
    expect(toSapPo(pay(), null)).toMatchObject({ ok: false });
    const bad = toSapPo(pay({ vendor: { name: "Acme", contactEmail: null }, awardedAt: null, currency: "Dirham" }, { unit: "Carton of twelve" }), MAP);
    expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.errors.join("|")).toMatch(/vendor number.*\|.*approval date.*\|.*currency.*\|.*no SAP unit/s);
    expect(toSapPo(pay({}, { quantity: "0" }), MAP)).toMatchObject({ ok: false });
    expect(toSapPo(pay({}, { unitPrice: "abc" }), MAP)).toMatchObject({ ok: false });
    expect(toSapPo(pay({ items: [] }), MAP)).toMatchObject({ ok: false });
  });
  it("warns about missing material numbers and long text", () => {
    const r = toSapPo(pay({}, { materialCode: undefined, description: "d".repeat(60) }), MAP);
    expect(r.ok).toBe(true); if (r.ok) { expect(r.warnings).toHaveLength(2); expect(r.document.to_PurchaseOrderItem[0]!.PurchaseOrderItemText).toHaveLength(40); expect(r.document.to_PurchaseOrderItem[0]).not.toHaveProperty("Material"); }
  });
  it("writes a flat file that cannot be read as a formula", () => {
    const r = toSapPo(pay({}, { description: '=HYPERLINK("x"), "q"' }), MAP);
    if (!r.ok) throw new Error("x");
    const csv = sapCsv([r.document]).split("\r\n");
    expect(csv[0]).toBe("PO_TYPE,COMP_CODE,PURCH_ORG,PUR_GROUP,VENDOR,CURRENCY,DOC_DATE,REF,ITEM,MATERIAL,SHORT_TEXT,PLANT,QUANTITY,UNIT,NET_PRICE,PRICE_UNIT");
    expect(csv[1]).toContain(`"'=HYPERLINK(""x""), ""q"""`); expect(csv[1]!.startsWith("NB,1000,1000,A01,0000100234,AED,2026-10-01,EV-2026-001,00010,MAT-1,")).toBe(true);
  });
});

describe("saving, previewing and the API", () => {
  it("is for administrators and stays inside one company", async () => {
    expect(await saveMapping(pool, who(X, "buyer"), MAP)).toEqual({ ok: false, error: SAP_NO_PERM });
    expect(await saveMapping(pool, who(X, "admin", "admin", ["config.manage"]), { ...MAP, companyCode: "bad code" })).toMatchObject({ ok: false });
    expect(await saveMapping(pool, who(X, "admin", "admin", ["config.manage"]), MAP)).toMatchObject({ ok: true });
    expect(await getMapping(pool, X.tenantId)).toEqual(MAP); expect(await getMapping(pool, Y.tenantId)).toBeNull();
    expect(await saveMapping(pool, who(X, "admin", "admin", ["config.manage"]), { ...MAP, plant: "" })).toMatchObject({ ok: true });
    expect((await getMapping(pool, X.tenantId))!.plant).toBe("");
    expect((await admin.query(`select count(*)::int n from audit_event where tenant_id = $1 and action = 'handover.sap_mapping'`, [X.tenantId])).rows[0].n).toBe(2);
  });
  it("builds the order for an awarded event, for the buyer only, and through the API", async () => {
    const e = await makeEvent(admin, X, "draft", { withBids: true });
    await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type, item_code) values ($1,$2,1,'Gloves',10,'ea','UNIT_PRICE','MAT-9')`, [X.tenantId, e.id]);
    await admin.query(`update sourcing_event set state = 'awarded', currency = 'AED', ref = 'EV-2026-777' where id = $1`, [e.id]);
    const win = X.suppliers[0].id;
    await admin.query(`update supplier_org set vendor_code = '0000555' where id = $1`, [win]);
    const rev = (await admin.query(`select id from bid_revision where event_id = $1 and supplier_id = $2`, [e.id, win])).rows[0].id;
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D7','price_lines',$3)`, [X.tenantId, rev, JSON.stringify({ lines: [{ lineNo: 1, quantity: "10", unitPrice: "12.5", amount: "125.00" }], total: "125.00" })]);
    await admin.query(`insert into recommendation (tenant_id, event_id, supplier_id, note, created_by) values ($1,$2,$3,'Lowest compliant bid.',$4)`, [X.tenantId, e.id, win, X.people.buyer.membershipId]);
    await admin.query(`insert into approval (tenant_id, event_id, step, decision, approver_membership_id, idempotency_key) values ($1,$2,'award','approve',$3,$4)`, [X.tenantId, e.id, X.people.admin.membershipId, `sap-${e.id}`]);
    const p = await previewSap(pool, who(X, "buyer"), e.id);
    expect(p, JSON.stringify(p)).toMatchObject({ ok: true });
    if (p.ok) expect(p.docs[0]).toMatchObject({ ok: true, document: { Supplier: "0000555", to_PurchaseOrderItem: [{ Material: "MAT-9", PurchaseOrderQuantityUnit: "EA", NetPriceAmount: "12.5" }] } });
    expect(await previewSap(pool, who(X, "techA"), e.id)).toMatchObject({ ok: false });
    expect(await previewSap(pool, who(Y, "buyer"), e.id)).toMatchObject({ ok: false });
    const c = await createClient(pool, who(X, "admin", "admin", ["integration.manage"]), { name: "ERP", scopes: ["awards:read"] });
    if (!c.ok) throw new Error(c.error);
    const a = (await authenticate(pool, `Bearer ${c.key}`))!;
    const api = await getAwardApi(pool, a, (await admin.query(`select ref from sourcing_event where id = $1`, [e.id])).rows[0].ref, "sap-po");
    expect(api.status).toBe(200); expect(api.body).toMatchObject({ purchaseOrders: [{ supplier: expect.any(String) }] });
    const plain = await getAwardApi(pool, a, (await admin.query(`select ref from sourcing_event where id = $1`, [e.id])).rows[0].ref);
    expect(plain.body).toHaveProperty("awards");
  });
});
