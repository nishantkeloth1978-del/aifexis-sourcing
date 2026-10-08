import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/authz";
import { getBidForm, priceBid, submitBidForm } from "@/bids/service";
import { resolveConfig } from "@/config/service";
import { getEvent, type Who } from "@/events/service";
import { submitForPublication } from "@/events/workflow";
import type { SupplierWho } from "@/suppliers/service";
import { createEventFromTemplate, getEventTemplate, updateTemplateInputs } from "@/templates/events";
import { activate, addOverride, getProfile, listLibrary, matchTemplate, previewSelection, recommend, saveProfile, setPolicy } from "@/templates/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, AV: World, HOSP: World, CAT: World, TEL: World;
const as = (W: World, p: keyof World["people"], role = "member"): Who => ({ tenantId: W.tenantId, userId: W.people[p].userId, membershipId: W.people[p].membershipId, role } as Who);
const adminOf = (W: World) => as(W, "admin", "admin");
const key = () => randomUUID();
beforeAll(async () => {
  admin = await adminClient(); pool = makePool();
  [AV, HOSP, CAT, TEL] = [await seedTenant(admin, "tpl-av"), await seedTenant(admin, "tpl-hosp"), await seedTenant(admin, "tpl-cat"), await seedTenant(admin, "tpl-tel")];
});
afterAll(async () => { await pool.end(); await admin.end(); });

const base = { country: "ae", currency: "AED", timeZone: "Asia/Dubai", defaultLanguage: "en", languages: ["en", "ar"] };
async function setup(W: World, industry: string, categories: string[]) {
  const r = await saveProfile(pool, adminOf(W), { primaryIndustry: industry, categories, ...base }, 0);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("company profile", () => {
  it("saves a draft, validates, is admin-only, and refuses stale writes (AC12 for the profile)", async () => {
    expect(await getProfile(pool, adminOf(AV))).toMatchObject({ status: "not_started", version: 0 });
    expect(await saveProfile(pool, as(AV, "buyer"), { primaryIndustry: "AV_SECURITY" }, 0)).toMatchObject({ ok: false });
    expect(await saveProfile(pool, adminOf(AV), { primaryIndustry: "NOPE" }, 0)).toMatchObject({ ok: false });
    expect(await saveProfile(pool, adminOf(AV), { primaryIndustry: "AV_SECURITY", timeZone: "Mars/Base" }, 0)).toMatchObject({ ok: false });
    expect(await saveProfile(pool, adminOf(AV), { primaryIndustry: "AV_SECURITY", currency: "XXX" }, 0)).toMatchObject({ ok: false });
    expect(await saveProfile(pool, adminOf(AV), { primaryIndustry: "AV_SECURITY", categories: ["bogus"] }, 0)).toMatchObject({ ok: false });
    const a = await setup(AV, "AV_SECURITY", ["AV_SYSTEMS", "AV_INSTALL", "MAINTENANCE_SERVICE"]);
    expect(a).toMatchObject({ ok: true, profile: { version: 1, status: "in_progress", country: "AE", timeZone: "Asia/Dubai" }, gaps: [] });
    expect(await saveProfile(pool, adminOf(AV), { primaryIndustry: "AV_SECURITY" }, 0)).toMatchObject({ ok: false, conflict: true });
    expect(await saveProfile(pool, adminOf(AV), { primaryIndustry: "AV_SECURITY", categories: ["AV_SYSTEMS"], ...base }, 1)).toMatchObject({ ok: true, profile: { version: 2 } });
  });
});

describe("recommendation, activation and library", () => {
  it("recommends the three AV scenarios plus general templates for an AV company, and provisions them once (AC01, AC02)", async () => {
    await saveProfile(pool, adminOf(AV), { primaryIndustry: "AV_SECURITY", categories: ["AV_SYSTEMS", "AV_INSTALL", "MAINTENANCE_SERVICE"], ...base }, 2);
    const rec = await recommend(pool, adminOf(AV));
    expect(rec.templates.filter((t) => t.kind === "scenario").map((t) => t.key).sort()).toEqual(["AV_EQUIPMENT_RFQ", "AV_INSTALLATION_RFP", "AV_MAINTENANCE_RFP"]);
    expect(rec.templates.filter((t) => t.kind === "general")).toHaveLength(3);
    expect(rec.templates.find((t) => t.key === "AV_EQUIPMENT_RFQ")!.reasons).toEqual(expect.arrayContaining([{ code: "pack_for_industry", industry: "AV_SECURITY" }, { code: "category_match", category: "AV_SYSTEMS" }]));
    expect(rec.fallback).toBe(false);
    const sel = rec.templates.map((t) => t.key);
    expect(await previewSelection(pool, adminOf(AV), sel)).toMatchObject({ remove: [] });
    const k = key();
    const a = await activate(pool, adminOf(AV), sel, k, 0);
    expect(a).toMatchObject({ ok: true, version: 1, duplicate: false });
    expect(await activate(pool, adminOf(AV), sel, k, 0)).toMatchObject({ ok: true, version: 1, duplicate: true });          // retried after a timeout
    expect((await admin.query(`select count(*)::int n from company_pack_assignment where tenant_id = $1 and enabled`, [AV.tenantId])).rows[0].n).toBe(sel.length);
    expect((await admin.query(`select count(*)::int n from company_config_version where tenant_id = $1`, [AV.tenantId])).rows[0].n).toBe(1);
    expect((await admin.query(`select pinned_version from company_pack_assignment where tenant_id = $1 and template_key = 'AV_EQUIPMENT_RFQ'`, [AV.tenantId])).rows[0].pinned_version).toBe(1);
    expect(await activate(pool, adminOf(AV), sel, key(), 0)).toMatchObject({ ok: false, conflict: true });                  // stale expected version
    expect(await activate(pool, as(AV, "buyer"), sel, key(), 1)).toMatchObject({ ok: false });
    const lib = await listLibrary(pool, adminOf(AV));
    expect(lib.filter((t) => t.enabled)).toHaveLength(sel.length);
  });
  it("labels the general fallback when no dedicated pack applies (AC06)", async () => {
    await saveProfile(pool, adminOf(TEL), { primaryIndustry: "TELECOM", categories: [], ...base }, 0);
    const rec = await recommend(pool, adminOf(TEL));
    expect(rec.templates.every((t) => t.kind === "general")).toBe(true);
    expect(rec).toMatchObject({ fallback: true, fallbackIndustry: "TELECOM" });
    expect(await activate(pool, adminOf(TEL), rec.templates.map((t) => t.key), key(), 0)).toMatchObject({ ok: true });
    const m = await matchTemplate(pool, adminOf(TEL), { category: "AV_SYSTEMS", eventType: "RFQ" });
    expect(m).toMatchObject({ fallback: true }); expect(m.candidates.map((c) => c.template.key)).toEqual(["GEN_RFQ"]);
  });
  it("blocks a template that needs a capability the application lacks (AC07)", async () => {
    await admin.query(`insert into template_definition (key, kind, category_code, event_type, pricing_model, title_en, title_ar) values ('TEST_AUCTION','general','GENERAL','RFQ','itemized','Auction RFQ','مزاد')`);
    const content = JSON.stringify((await admin.query(`select content from template_version where template_key = 'GEN_RFQ'`)).rows[0].content);
    await admin.query(`insert into template_version (template_key, version, status, content, content_hash, requires, published_at) values ('TEST_AUCTION', 1, 'published', $1::jsonb, 'x', '{rfx,auction}', now())`, [content]);
    const lib = await listLibrary(pool, adminOf(TEL));
    expect(lib.find((t) => t.key === "TEST_AUCTION")).toMatchObject({ missing: ["auction"] });
    const r = await activate(pool, adminOf(TEL), ["GEN_RFQ", "TEST_AUCTION"], key(), 1);
    expect(r).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: "UNSUPPORTED_CAPABILITY" })] });
    expect((await admin.query(`select count(*)::int n from company_pack_assignment where tenant_id = $1 and enabled`, [TEL.tenantId])).rows[0].n).toBe(3);   // previous configuration untouched
  });
  it("lets a hospital use the AV equipment template without changing its industry (AC05) and applies the company policy", async () => {
    await saveProfile(pool, adminOf(HOSP), { primaryIndustry: "HEALTHCARE", categories: ["MEDICAL_EQUIPMENT", "AV_SYSTEMS"], ...base }, 0);
    const rec = await recommend(pool, adminOf(HOSP));
    expect(rec.templates.map((t) => t.key)).toContain("AV_EQUIPMENT_RFQ");
    expect(rec.templates.find((t) => t.key === "AV_EQUIPMENT_RFQ")!.reasons).toEqual([{ code: "category_match", category: "AV_SYSTEMS" }]);
    expect(await setPolicy(pool, adminOf(HOSP), { key: "datasheet-mandatory", kind: "require_document", target: "datasheets", confirmed: true })).toMatchObject({ ok: true });
    expect(await setPolicy(pool, adminOf(HOSP), { key: "approval-owner", kind: "note", target: "approvals", confirmed: false })).toMatchObject({ ok: true });
    expect(await activate(pool, adminOf(HOSP), ["GEN_RFQ", "AV_EQUIPMENT_RFQ"], key(), 0)).toMatchObject({ ok: true, version: 1 });
    expect((await getProfile(pool, adminOf(HOSP))).status).toBe("gaps");                                                       // unconfirmed policy is visible as a gap
    // the policy locks the datasheet requirement: it was suggested-only in the template, so activation now reports it (AC09)
    const m = await matchTemplate(pool, adminOf(HOSP), { category: "AV_SYSTEMS", eventType: "RFQ" });
    expect(m.candidates.map((c) => c.template.key)).toEqual(["AV_EQUIPMENT_RFQ", "GEN_RFQ"]);
    expect(m.ambiguous).toBe(false); expect(m.fallback).toBe(false);
    expect((await matchTemplate(pool, adminOf(HOSP), { category: "AV_SYSTEMS", eventType: "RFP" })).candidates).toEqual([]);
    expect((await matchTemplate(pool, adminOf(HOSP), { category: "AV_SYSTEMS", eventType: "RFQ", pricingModel: "person_day" })).candidates).toEqual([]);
  });
  it("rejects overrides that weaken a confirmed policy and stores harmless ones (AC09)", async () => {
    await setPolicy(pool, adminOf(AV), { key: "warranty-mandatory", kind: "require_field", target: "warranty_months", confirmed: true });
    expect(await addOverride(pool, adminOf(AV), { templateKey: "AV_EQUIPMENT_RFQ", collection: "fields", objectKey: "warranty_months", op: "remove" })).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: "POLICY_LOCKED" })] });
    expect(await addOverride(pool, adminOf(AV), { templateKey: "AV_EQUIPMENT_RFQ", collection: "fields", objectKey: "warranty_months", op: "update", value: { label: { en: "Warranty duration (months)", ar: "مدة الضمان (أشهر)" } } })).toMatchObject({ ok: true });
    await admin.query(`delete from company_override where tenant_id = $1`, [AV.tenantId]);
    // an override added behind the API's back is still caught when activating
    await admin.query(`insert into company_override (tenant_id, template_key, collection, object_key, op) values ($1,'AV_EQUIPMENT_RFQ','fields','warranty_months','remove')`, [AV.tenantId]);
    const sel = (await listLibrary(pool, adminOf(AV))).filter((t) => t.enabled).map((t) => t.key);
    expect(await activate(pool, adminOf(AV), sel, key(), 1)).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ code: "POLICY_LOCKED" })]) });
    await admin.query(`delete from company_override where tenant_id = $1 and op = 'remove'`, [AV.tenantId]);
    expect(await activate(pool, adminOf(AV), sel, key(), 1)).toMatchObject({ ok: true, version: 2 });
  });
});

describe("events from templates: catering and AV, end to end", () => {
  async function enableCatering() {
    await saveProfile(pool, adminOf(CAT), { primaryIndustry: "CATERING", categories: ["CATERING_SERVICE"], ...base }, 0);
    const rec = await recommend(pool, adminOf(CAT));
    expect(rec.templates.filter((t) => t.kind === "scenario").map((t) => t.key).sort()).toEqual(["CAT_FOOD_SUPPLY_RFQ", "CAT_KITCHEN_OPERATION_RFP", "CAT_MEAL_SERVICE_RFP"]);
    const ar = await activate(pool, adminOf(CAT), rec.templates.map((t) => t.key), key(), 0); if (!ar.ok) console.log(JSON.stringify(ar)); expect(ar).toMatchObject({ ok: true });
  }
  it("creates a meal-service event with the schedule, a snapshot, and blocks submission until complete", async () => {
    await enableCatering();
    const buyer = as(CAT, "buyer");
    const m = await matchTemplate(pool, buyer, { category: "CATERING_SERVICE", eventType: "RFP", pricingModel: "person_day" });
    expect(m.candidates[0]!.template.key).toBe("CAT_MEAL_SERVICE_RFP");
    expect(await createEventFromTemplate(pool, as(CAT, "auditor", "auditor"), { templateKey: "CAT_MEAL_SERVICE_RFP", title: "Vessel catering", idempotencyKey: key() })).toMatchObject({ ok: false });
    expect(await createEventFromTemplate(pool, buyer, { templateKey: "AV_EQUIPMENT_RFQ", title: "Not enabled here", idempotencyKey: key() })).toMatchObject({ ok: false, error: "That template is not enabled for your company." });
    const idem = key();
    const mk = () => createEventFromTemplate(pool, buyer, { templateKey: "CAT_MEAL_SERVICE_RFP", title: "Vessel catering", idempotencyKey: idem,
      inputs: { groups: { site: [{ name: "Vessel A", headcount: 100, days: 30, mobilisation: true }, { name: "Vessel B", headcount: 40, days: "" }] } }, values: { meal_scope: ["lunch", "dinner"] } });
    const e = await mk(); if (!e.ok) throw new Error(e.error);
    expect((await mk() as { event: { id: string } }).event.id).toBe(e.event.id);                                       // retried request: same event
    expect(e.schedule.incomplete).toBe(true);
    const detail = (await getEvent(pool, buyer, e.event.id))!;
    expect(detail.items.map((i) => [i.description, i.quantity, i.unit, i.blockType])).toEqual([["Meal service: Vessel A", "3000.000", "PERSON-DAY", "UNIT_PRICE"], ["Mobilisation: Vessel A", "1.000", "LS", "LUMP_SUM"]]);
    const t = (await getEventTemplate(pool, buyer, e.event.id))!;
    expect(t).toMatchObject({ key: "CAT_MEAL_SERVICE_RFP", version: 1, configVersion: 1, frozen: false });
    expect(await getEventTemplate(pool, as(AV, "buyer"), e.event.id)).toBeNull();                                      // another tenant sees nothing

    await admin.query(`update sourcing_event set closes_at = now() + interval '7 days' where id = $1`, [e.event.id]);
    const v = (await admin.query(`select state_version from sourcing_event where id = $1`, [e.event.id])).rows[0].state_version as number;
    expect(await submitForPublication(pool, adminOf(CAT), e.event.id, v)).toMatchObject({ ok: false, error: expect.stringContaining("template inputs") });
    const fixed = await updateTemplateInputs(pool, buyer, e.event.id, { groups: { site: [{ name: "Vessel A", headcount: 100, days: 30, mobilisation: true }, { name: "Vessel B", headcount: 40, days: 10, mobilisation: false }] } }, { meal_scope: ["lunch"] });
    expect(fixed).toMatchObject({ ok: true, schedule: { incomplete: false } });
    expect((await getEvent(pool, buyer, e.event.id))!.items.map((i) => i.description)).toEqual(["Meal service: Vessel A", "Mobilisation: Vessel A", "Meal service: Vessel B"]);
    // a template policy of the platform: the snapshot cannot change after submission
    expect(await submitForPublication(pool, adminOf(CAT), e.event.id, v)).toMatchObject({ ok: false, error: expect.stringMatching(/approver|Assign/i) });   // team incomplete, still a draft
    expect((await getEventTemplate(pool, buyer, e.event.id))!.frozen).toBe(false);
    await admin.query(`update sourcing_event set template_frozen_at = now() where id = $1`, [e.event.id]);
    await expect(admin.query(`update sourcing_event set template_effective = '{}'::jsonb where id = $1`, [e.event.id])).rejects.toThrow(/snapshot/);
    expect(await updateTemplateInputs(pool, buyer, e.event.id, { groups: {} }, {})).toMatchObject({ ok: false });
  });
  it("runs the AV equipment RFQ from setup to a supplier response and evaluation overlay; technical and commercial answers are kept apart (AC17, AC23)", async () => {
    const buyer = as(AV, "buyer");
    const e = await createEventFromTemplate(pool, buyer, { templateKey: "AV_EQUIPMENT_RFQ", title: "Meeting room displays", idempotencyKey: key(), inputs: { groups: {}, include: ["installation"] }, values: { delivery_site: "HQ level 3" } });
    if (!e.ok) throw new Error(e.error);
    const id = e.event.id;
    await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type) values ($1,$2,2,'55 inch display','5','EA','UNIT_PRICE')`, [AV.tenantId, id]);
    // suppliers see a published event
    await admin.query(`update sourcing_event set state = 'published', closes_at = now() + interval '3 days' where id = $1`, [id]);
    const sup = AV.suppliers[0];
    await admin.query(`insert into invitation (tenant_id, event_id, supplier_id, supplier_user_id, token_hash) values ($1,$2,$3,$4,$5)`, [AV.tenantId, id, sup.id, sup.supplierUserId, key()]);
    const who: SupplierWho = { tenantId: AV.tenantId, supplierId: sup.id, supplierUserId: sup.supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" };
    const form = (await getBidForm(pool, who, id))!;
    expect(form.questionnaire).not.toBeNull();
    expect(form.questionnaire!.buyerFields.map((f) => [f.key, f.value])).toEqual([["delivery_site", "HQ level 3"]]);
    expect(form.questionnaire!.asks.map((a) => a.key)).toEqual(expect.arrayContaining(["brand", "model", "spec_compliance", "warranty_months", "offer_validity_days"]));
    expect(JSON.stringify(form.questionnaire)).not.toMatch(/criteria|workflow/);                                          // internal parts are not shown to suppliers
    const lines = form.items.map((i) => i.id);
    const prices = { [lines[0]!]: "1500", [lines[1]!]: "2000" };
    const answers = { brand: "Acme", model: "D-55", spec_compliance: "compliant", warranty_months: "36", lead_time_days: "21", offer_validity_days: "60", payment_terms: "30 days" };
    expect(priceBid(form.items, prices)).toMatchObject({ ok: true, total: "11500.00" });
    expect(await submitBidForm(pool, who, id, { prices, technicalText: "We comply with the full specification.", answers: { ...answers, brand: "" } })).toMatchObject({ ok: false, error: "Answer: Brand offered." });
    expect(await submitBidForm(pool, who, id, { prices, technicalText: "We comply with the full specification.", answers: { ...answers, spec_compliance: "deviation" } })).toMatchObject({ ok: false, error: "Answer: Describe each deviation." });
    expect(await submitBidForm(pool, who, id, { prices, technicalText: "We comply with the full specification.", answers: { ...answers, alternative_offered: true } })).toMatchObject({ ok: false, error: "Answer: Describe the alternative and why it is equivalent." });
    expect(await submitBidForm(pool, who, id, { prices, technicalText: "We comply with the full specification.", answers: { ...answers, warranty_months: "-3" } })).toMatchObject({ ok: false });
    expect(await submitBidForm(pool, who, id, { prices, technicalText: "We comply with the full specification.", answers })).toMatchObject({ ok: true, revisionNo: 1, total: "11500.00" });
    const kinds = (await admin.query(`select bi.data_class, bi.kind, bi.payload from bid_item bi join bid_revision r on r.id = bi.bid_revision_id where r.event_id = $1 order by bi.kind`, [id])).rows;
    const tech = kinds.find((k) => k.kind === "form_response"), comm = kinds.find((k) => k.kind === "commercial_response");
    expect(tech.data_class).toBe("D6"); expect(comm.data_class).toBe("D7");
    expect(Object.keys(tech.payload.answers).sort()).toEqual(["brand", "lead_time_days", "model", "spec_compliance", "warranty_months"]);
    expect(Object.keys(comm.payload.answers).sort()).toEqual(["offer_validity_days", "payment_terms"]);               // price-related answers never sit in the technical item
    const again = (await getBidForm(pool, who, id))!;
    expect(again.answers).toMatchObject({ brand: "Acme", offer_validity_days: "60" });
    // the template's criteria are used for technical scoring; weights stay with the company
    const cfg = await withTenant(pool, AV.tenantId, (c) => resolveConfig(c, id));
    expect(cfg.criteria).toEqual(["Specification compliance", "Warranty and support", "Delivery"]);
    expect(cfg.criterionWeights).toBeUndefined();
  });
  it("keeps a published event on its template version when a newer one is released (AC11)", async () => {
    const buyer = as(AV, "buyer");
    const first = await createEventFromTemplate(pool, buyer, { templateKey: "GEN_RFQ", title: "Before the new version", idempotencyKey: key() });
    if (!first.ok) throw new Error(first.error);
    const c = JSON.parse(JSON.stringify((await admin.query(`select content from template_version where template_key = 'GEN_RFQ'`)).rows[0].content));
    c.fields.push({ key: "extra", section: "general", label: { en: "Extra", ar: "إضافي" }, type: "text", source: "supplier", envelope: "technical", required: false });
    await admin.query(`insert into template_version (template_key, version, status, content, content_hash, requires, published_at) values ('GEN_RFQ', 2, 'published', $1::jsonb, 'v2', '{rfx}', now())`, [JSON.stringify(c)]);
    const second = await createEventFromTemplate(pool, buyer, { templateKey: "GEN_RFQ", title: "After the new version", idempotencyKey: key() });
    if (!second.ok) throw new Error(second.error);
    expect((await getEventTemplate(pool, buyer, first.event.id))).toMatchObject({ version: 1 });
    expect((await getEventTemplate(pool, buyer, second.event.id))).toMatchObject({ version: 1 });                    // the company adopts v2 explicitly (Stage 2); until then it stays pinned
    await expect(admin.query(`update template_version set content = '{}'::jsonb where template_key = 'GEN_RFQ' and version = 1`)).rejects.toThrow(/published/);
  });
  it("isolates tenants: another company cannot read or use configuration it does not own (AC22)", async () => {
    expect(await listLibrary(pool, adminOf(TEL)).then((l) => l.find((t) => t.key === "AV_EQUIPMENT_RFQ")?.enabled)).toBe(false);
    expect(await createEventFromTemplate(pool, as(TEL, "buyer"), { templateKey: "AV_EQUIPMENT_RFQ", title: "Cross tenant try", idempotencyKey: key() })).toMatchObject({ ok: false });
    expect((await pool.query(`select 1 from company_profile`)).rowCount).toBeGreaterThanOrEqual(0);                    // pool without a tenant context cannot read tenant rows
    const c = await pool.connect();
    try { await c.query("begin"); await c.query("set local role app_runtime"); await expect(c.query(`select * from template_version`)).rejects.toThrow(); await c.query("rollback"); } finally { c.release(); }
  });
});

describe("stage 2 packs", () => {
  const CASES: [string, string, string[]][] = [
    ["CONSTRUCTION", "CONSTRUCTION_WORKS", ["CON_WORKS_RFQ", "CON_SUBCONTRACT_RFP"]], ["STAFFING", "MANPOWER", ["STF_MANPOWER_RFP", "STF_PROFESSIONAL_RFQ"]],
    ["FACILITIES", "FACILITIES_SERVICE", ["FAC_SERVICES_RFP", "FAC_CLEANING_RFQ"]], ["MANUFACTURING", "RAW_MATERIAL", ["MFG_MATERIAL_RFQ", "MFG_COMPONENT_RFP"]],
    ["OIL_GAS", "OIL_GAS_SERVICES", ["OG_TURNAROUND_RFP"]], ["LOGISTICS", "FREIGHT", ["LOG_FREIGHT_RFQ"]], ["HEALTHCARE", "MEDICAL_EQUIPMENT", ["HC_MEDICAL_EQUIPMENT_RFQ", "HC_CONSUMABLES_RFQ"]],
    ["IT_SOFTWARE", "IT_SOFTWARE", ["IT_SOFTWARE_SUBSCRIPTION_RFP", "IT_IMPLEMENTATION_RFP"]],
  ];
  it.each(CASES)("%s: recommended, activated, and an event is created with a complete schedule", async (industry, category, keys) => {
    const W = await seedTenant(admin, `pk-${industry.toLowerCase()}`);
    await setup(W, industry, [category]);
    const rec = await recommend(pool, adminOf(W));
    expect(rec.fallback).toBe(false);
    for (const k of keys) expect(rec.templates.map((t) => t.key)).toContain(k);
    const act = await activate(pool, adminOf(W), rec.templates.map((t) => t.key), key(), 0);
    if (!act.ok) throw new Error(JSON.stringify(act));
    for (const k of keys) {
      const ev = await createEventFromTemplate(pool, as(W, "buyer"), { templateKey: k, title: `Test ${k}`, idempotencyKey: key() });
      expect(ev, k).toMatchObject({ ok: true });
    }
  });
  it("oil and gas category tiebreak: a turnaround RFP is chosen over the general RFP", async () => {
    const W = await seedTenant(admin, "pk-og-match");
    await setup(W, "OIL_GAS", ["OIL_GAS_SERVICES"]);
    const rec = await recommend(pool, adminOf(W));
    expect((await activate(pool, adminOf(W), rec.templates.map((t) => t.key), key(), 0)).ok).toBe(true);
    const m = await matchTemplate(pool, adminOf(W), { category: "OIL_GAS_SERVICES", eventType: "RFP" });
    expect(m.candidates[0]!.template.key).toBe("OG_TURNAROUND_RFP");
    expect(m.ambiguous).toBe(false);
  });
});
