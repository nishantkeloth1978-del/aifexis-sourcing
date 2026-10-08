import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Who } from "@/events/service";
import { cloneTemplate, sanitise, saveCompanyTemplate } from "@/templates/custom";
import { createEventFromTemplate, getEventTemplate } from "@/templates/events";
import { previewEffective } from "@/templates/lifecycle";
import { activate, listLibrary, matchTemplate, saveProfile } from "@/templates/service";
import { ALL_TEMPLATES } from "@/templates/packs";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, A: World, B: World;
const adm = (W: World): Who => ({ tenantId: W.tenantId, userId: W.people.admin.userId, membershipId: W.people.admin.membershipId, role: "admin" } as Who);
const buyer = (W: World): Who => ({ tenantId: W.tenantId, userId: W.people.buyer.userId, membershipId: W.people.buyer.membershipId, role: "member" } as Who);
const key = () => randomUUID();
const meta = { key: "CO_SITE_SURVEY", title: { en: "Site survey RFQ", ar: "طلب عرض مسح الموقع" }, category: "SERVICES", eventType: "RFQ" as const };
const mini = () => ({
  fields: [{ key: "survey_days", section: "general", label: { en: "Survey days", ar: "أيام المسح" }, type: "integer", source: "supplier", envelope: "technical", required: true }],
  questions: [], documents: [],
  pricing: { model: "itemized", groups: [{ key: "site", label: { en: "Site", ar: "الموقع" }, repeat: true, inputs: [{ key: "visits", label: { en: "Visits", ar: "الزيارات" }, type: "integer", required: true }] }],
    lines: [{ key: "visit", group: "site", description: { en: "Survey visit: {name}", ar: "زيارة مسح: {name}" }, quantity: "visits", unit: "VISIT", block: "UNIT_PRICE" }] },
  evaluation: { modes: ["price", "manual"], mode: "price", scale: { min: 0, max: 5 }, criteria: [] },
});
beforeAll(async () => {
  admin = await adminClient(); pool = makePool(); [A, B] = [await seedTenant(admin, "cust-a"), await seedTenant(admin, "cust-b")];
  for (const W of [A, B]) await saveProfile(pool, adm(W), { primaryIndustry: "CONSTRUCTION", categories: ["SERVICES"], country: "ae", currency: "AED", timeZone: "Asia/Dubai", defaultLanguage: "en", languages: ["en", "ar"] }, 0);
});
afterAll(async () => { await pool.end(); await admin.end(); });

describe("company templates", () => {
  it("rejects malformed content with plain reasons and unsafe expressions", async () => {
    expect(sanitise("x")).toMatchObject({ ok: false });
    expect(sanitise({ fields: [{ key: "BAD KEY" }] })).toMatchObject({ ok: false });
    const m = mini(); (m.pricing.lines[0] as { quantity: string }).quantity = "visits + process.exit()";
    expect(await saveCompanyTemplate(pool, adm(A), meta, m)).toMatchObject({ ok: false, error: "The template content is not valid." });
    const m2 = mini(); (m2.pricing.lines[0] as { group: string }).group = "nope";
    expect(await saveCompanyTemplate(pool, adm(A), meta, m2)).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: "BROKEN_REFERENCE" })] });
    expect(await saveCompanyTemplate(pool, buyer(A), meta, mini())).toMatchObject({ ok: false });
    expect(await saveCompanyTemplate(pool, adm(A), { ...meta, key: "GEN_RFQ" }, mini())).toMatchObject({ ok: false });
    expect(await saveCompanyTemplate(pool, adm(A), { ...meta, key: "CO_X", category: "NOPE" }, mini())).toMatchObject({ ok: false });
  });
  it("publishes, versions, isolates between companies, and drives an event end to end", async () => {
    expect(await saveCompanyTemplate(pool, adm(A), meta, mini())).toMatchObject({ ok: true, version: 1 });
    expect(await saveCompanyTemplate(pool, adm(A), meta, mini(), "again")).toMatchObject({ ok: true, version: 2 });
    expect((await listLibrary(pool, adm(A))).find((t) => t.key === "CO_SITE_SURVEY")).toMatchObject({ version: 2, enabled: false });
    expect((await listLibrary(pool, adm(B))).find((t) => t.key === "CO_SITE_SURVEY")).toBeUndefined();                   // another company never sees it
    await expect(admin.query(`update company_template_version set content = '{}' where template_key = 'CO_SITE_SURVEY'`)).rejects.toThrow(/cannot be changed/);
    const a = await activate(pool, adm(A), ["GEN_RFQ", "CO_SITE_SURVEY"], key(), 0);
    expect(a).toMatchObject({ ok: true });
    expect(await activate(pool, adm(B), ["CO_SITE_SURVEY"], key(), 0)).toMatchObject({ ok: false });                     // not B's template
    expect((await matchTemplate(pool, adm(A), { category: "SERVICES", eventType: "RFQ" })).candidates[0]!.template.key).toBe("CO_SITE_SURVEY");
    const e = await createEventFromTemplate(pool, buyer(A), { templateKey: "CO_SITE_SURVEY", title: "Survey", idempotencyKey: key(), inputs: { groups: { site: [{ name: "Plant 1", visits: 3 }] } } });
    if (!e.ok) throw new Error(e.error);
    expect(e.schedule.items).toMatchObject([{ description: "Survey visit: Plant 1", quantity: "3.000", unit: "VISIT" }]);
    expect(await getEventTemplate(pool, buyer(A), e.event.id)).toMatchObject({ key: "CO_SITE_SURVEY", version: 2 });
    expect(await createEventFromTemplate(pool, buyer(B), { templateKey: "CO_SITE_SURVEY", title: "Nope", idempotencyKey: key() })).toMatchObject({ ok: false });
  });
  it("clones a platform template as a starting point, and round-trips an export", async () => {
    const r = await cloneTemplate(pool, adm(A), "AV_EQUIPMENT_RFQ", { key: "CO_MY_AV", title: { en: "Our AV RFQ", ar: "طلب AV الخاص بنا" }, category: "AV_SYSTEMS", eventType: "RFQ" });
    expect(r).toMatchObject({ ok: true, version: 1 });
    const p = await previewEffective(pool, adm(A), "CO_MY_AV");
    expect(p!.effective.fields.map((f) => f.key)).toEqual(expect.arrayContaining(ALL_TEMPLATES.find((t) => t.meta.key === "AV_EQUIPMENT_RFQ")!.content.fields.map((f) => f.key)));
    const again = await saveCompanyTemplate(pool, adm(A), { key: "CO_MY_AV2", title: { en: "Copy", ar: "نسخة" }, category: "AV_SYSTEMS", eventType: "RFQ" }, JSON.parse(JSON.stringify(p!.effective)));
    expect(again).toMatchObject({ ok: true });                                                                           // an exported file imports cleanly
  });
});

import { recommendationGap } from "@/templates/service";
describe("profile change impact", () => {
  it("shows what a changed profile recommends without changing what is enabled", async () => {
    const W = await seedTenant(admin, "cust-gap");
    await saveProfile(pool, adm(W), { primaryIndustry: "CATERING", categories: ["CATERING_SERVICE"], country: "ae", currency: "AED", timeZone: "Asia/Dubai", defaultLanguage: "en", languages: ["en"] }, 0);
    expect((await recommendationGap(pool, adm(W))).newlyRecommended.map((t) => t.key).sort()).toEqual(["CAT_FOOD_SUPPLY_RFQ", "CAT_KITCHEN_OPERATION_RFP", "CAT_MEAL_SERVICE_RFP"]);
    expect(await activate(pool, adm(W), ["CAT_MEAL_SERVICE_RFP"], key(), 0)).toMatchObject({ ok: true });
    await saveProfile(pool, adm(W), { primaryIndustry: "LOGISTICS", categories: ["FREIGHT"], country: "ae", currency: "AED", timeZone: "Asia/Dubai", defaultLanguage: "en", languages: ["en"] }, 1);
    const g = await recommendationGap(pool, adm(W));
    expect(g.newlyRecommended.map((t) => t.key)).toContain("LOG_FREIGHT_RFQ");
    expect(g.notRecommended.map((t) => t.key)).toEqual(["CAT_MEAL_SERVICE_RFP"]);
    expect((await listLibrary(pool, adm(W))).find((t) => t.key === "CAT_MEAL_SERVICE_RFP")!.enabled).toBe(true);
  });
});
