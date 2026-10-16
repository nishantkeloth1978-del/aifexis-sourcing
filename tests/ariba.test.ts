import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkAribaMapping, getAribaMapping, saveAribaMapping, toAribaOrder, AR_NO_PERM, type AribaMapping } from "@/handover/ariba";
import { previewAriba } from "@/handover/ariba-service";
import type { HandoverPayload } from "@/handover/service";
import { createClient } from "@/integrations/service";
import { authenticate, getAwardApi } from "@/integrations/api";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World, Y: World;
const who = (w: World, p: keyof World["people"], role = "member", perms?: string[]): Who => ({ tenantId: w.tenantId, userId: w.people[p].userId, membershipId: w.people[p].membershipId, role, ...(perms ? { perms } : {}) } as Who);
const ADM = (w: World) => who(w, "admin", "admin", ["config.manage", "integration.manage"]);
beforeAll(async () => { process.env.SIGNING_SECRET = "t".repeat(40); admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "arb-x"); Y = await seedTenant(admin, "arb-y"); });
afterAll(async () => { await pool.end(); await admin.end(); });

const MAP: AribaMapping = { buyerNetworkId: "AN01234567890", buyerName: "Acme Industries", shipToName: "", testMode: true, uomMap: { PAIR: "PR" } };
const pay = (patch: Partial<HandoverPayload> = {}, item: object = {}): HandoverPayload => ({ schema: "aifexis.award.v1", target: "ARIBA", eventRef: "EV-2026-001", title: "Gloves", currency: "AED", awardedAt: "2026-10-01T08:00:00.000Z",
  vendor: { name: "Sup & Co", contactEmail: null, vendorCode: "AN99887766" }, items: [{ lineNo: 1, materialCode: "MAT-1", description: "Nitrile gloves", quantity: "200", unit: "PAIR", unitPrice: "3.5", netAmount: "700.00", ...item }], totalNet: "700.00", recommendation: "x", ...patch });

describe("mapping rules", () => {
  it("cleans and checks the mapping", () => {
    expect(checkAribaMapping({ ...MAP, uomMap: { pair: "pr" } })).toMatchObject({ ok: true, value: { uomMap: { PAIR: "PR" }, testMode: true } });
    expect(checkAribaMapping({ ...MAP, testMode: false })).toMatchObject({ ok: true, value: { testMode: false } });
    for (const bad of [{}, { ...MAP, buyerNetworkId: "a b" }, { ...MAP, buyerNetworkId: "<x>" }, { ...MAP, buyerName: "x" }, { ...MAP, uomMap: { EA: "TOOLONG" } }, { ...MAP, uomMap: [] }, { ...MAP, shipToName: "y" }])
      expect(checkAribaMapping(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
  });
  it("writes a cXML order request with mapped identity and units", () => {
    const r = toAribaOrder(pay(), MAP);
    expect(r).toMatchObject({ ok: true, orderId: "EV-2026-001-AN99887766" });
    if (!r.ok) return;
    expect(r.xml).toContain('<Credential domain="NetworkID"><Identity>AN01234567890</Identity></Credential>');
    expect(r.xml).toContain('<To><Credential domain="NetworkID"><Identity>AN99887766</Identity>');
    expect(r.xml).toContain('deploymentMode="test"'); expect(r.xml).toContain('orderDate="2026-10-01T08:00:00+00:00"');
    expect(r.xml).toContain('<ItemOut quantity="200" lineNumber="1">'); expect(r.xml).toContain("<UnitOfMeasure>PR</UnitOfMeasure>"); expect(r.xml).toContain('<Money currency="AED">3.5</Money>'); expect(r.xml).toContain('<Money currency="AED">700.00</Money>');
    expect(toAribaOrder(pay({ vendor: { name: "S", contactEmail: null, vendorCode: "V-100" } }), { ...MAP, testMode: false }))
      .toMatchObject({ ok: true, xml: expect.stringContaining('<Credential domain="VendorID"><Identity>V-100</Identity>') });
  });
  it("cannot be broken out of by text from the award", () => {
    const r = toAribaOrder(pay({ title: '"><evil/>', vendor: { name: "S", contactEmail: null, vendorCode: "AN1" } }, { description: '</Description><Injected a="1"/>&<![CDATA[x]]>', materialCode: 'P"1' }), MAP);
    if (!r.ok) throw new Error("x");
    expect(r.xml).not.toContain("<Injected"); expect(r.xml).not.toContain("<evil/>"); expect(r.xml).not.toContain("<![CDATA["); expect(r.xml).toContain("&lt;Injected a=&quot;1&quot;/&gt;&amp;");
    expect((r.xml.match(/<ItemOut /g) ?? []).length).toBe(1);
  });
  it("names every missing piece instead of guessing", () => {
    expect(toAribaOrder(pay(), null)).toMatchObject({ ok: false });
    const bad = toAribaOrder(pay({ vendor: { name: "S", contactEmail: null }, awardedAt: null, currency: "Dirham" }, { unit: "Carton of twelve" }), MAP);
    expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.errors.join("|")).toMatch(/vendor number.*\|.*approval date.*\|.*currency.*\|.*no unit code/s);
    expect(toAribaOrder(pay({}, { quantity: "-1" }), MAP)).toMatchObject({ ok: false });
    expect(toAribaOrder(pay({}, { unitPrice: "1e5" }), MAP)).toMatchObject({ ok: false });
    expect(toAribaOrder(pay({ items: [] }), MAP)).toMatchObject({ ok: false });
    const w = toAribaOrder(pay({}, { materialCode: undefined }), MAP);
    expect(w.ok && w.warnings.length).toBe(2);
  });
});

describe("saving, previewing and the API", () => {
  it("is for administrators and stays inside one company", async () => {
    expect(await saveAribaMapping(pool, who(X, "buyer"), MAP)).toEqual({ ok: false, error: AR_NO_PERM });
    expect(await saveAribaMapping(pool, ADM(X), { ...MAP, buyerName: "" })).toMatchObject({ ok: false });
    expect(await saveAribaMapping(pool, ADM(X), MAP)).toMatchObject({ ok: true });
    expect(await getAribaMapping(pool, X.tenantId)).toEqual(MAP); expect(await getAribaMapping(pool, Y.tenantId)).toBeNull();
    expect(await saveAribaMapping(pool, ADM(X), { ...MAP, shipToName: "Plant A store" })).toMatchObject({ ok: true });
    expect((await getAribaMapping(pool, X.tenantId))!.shipToName).toBe("Plant A store");
    expect((await admin.query(`select count(*)::int n from audit_event where tenant_id = $1 and action = 'handover.ariba_mapping'`, [X.tenantId])).rows[0].n).toBe(2);
  });
  it("builds the order for an awarded event, for the buyer only, and through the API", async () => {
    const e = await makeEvent(admin, X, "draft", { withBids: true });
    await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type, item_code) values ($1,$2,1,'Gloves',10,'ea','UNIT_PRICE','MAT-9')`, [X.tenantId, e.id]);
    await admin.query(`update sourcing_event set state = 'awarded', currency = 'AED', ref = 'EV-2026-888' where id = $1`, [e.id]);
    const win = X.suppliers[0].id;
    await admin.query(`update supplier_org set vendor_code = 'AN5550001' where id = $1`, [win]);
    const rev = (await admin.query(`select id from bid_revision where event_id = $1 and supplier_id = $2`, [e.id, win])).rows[0].id;
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D7','price_lines',$3)`, [X.tenantId, rev, JSON.stringify({ lines: [{ lineNo: 1, quantity: "10", unitPrice: "12.5", amount: "125.00" }], total: "125.00" })]);
    await admin.query(`insert into recommendation (tenant_id, event_id, supplier_id, note, created_by) values ($1,$2,$3,'Lowest compliant bid.',$4)`, [X.tenantId, e.id, win, X.people.buyer.membershipId]);
    await admin.query(`insert into approval (tenant_id, event_id, step, decision, approver_membership_id, idempotency_key) values ($1,$2,'award','approve',$3,$4)`, [X.tenantId, e.id, X.people.admin.membershipId, `arb-${e.id}`]);
    const p = await previewAriba(pool, who(X, "buyer"), e.id);
    expect(p, JSON.stringify(p)).toMatchObject({ ok: true });
    if (p.ok) expect(p.docs[0]).toMatchObject({ ok: true, orderId: "EV-2026-888-AN5550001", xml: expect.stringContaining("<SupplierPartID>MAT-9</SupplierPartID>") });
    expect(await previewAriba(pool, who(X, "techA"), e.id)).toMatchObject({ ok: false });
    expect(await previewAriba(pool, who(Y, "buyer"), e.id)).toMatchObject({ ok: false });
    const c = await createClient(pool, ADM(X), { name: "ERP", scopes: ["awards:read"] });
    if (!c.ok) throw new Error(c.error);
    const a = (await authenticate(pool, `Bearer ${c.key}`))!;
    const api = await getAwardApi(pool, a, "EV-2026-888", "ariba-cxml");
    expect(api.status).toBe(200); expect(api.body).toMatchObject({ orders: [{ orderId: "EV-2026-888-AN5550001", cxml: expect.stringContaining("<cXML ") }] });
    expect((await getAwardApi(pool, a, "EV-2026-888")).body).toHaveProperty("awards");
  });
});
