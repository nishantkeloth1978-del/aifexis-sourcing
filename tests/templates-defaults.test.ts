import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Who } from "@/events/service";
import { listDefaults, setDefault } from "@/templates/defaults";
import { activate, matchTemplate, recommend, saveProfile } from "@/templates/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, W: World;
const as = (p: keyof World["people"], role = "member"): Who => ({ tenantId: W.tenantId, userId: W.people[p].userId, membershipId: W.people[p].membershipId, role } as Who);
const A = () => as("admin", "admin");
const base = { country: "ae", currency: "AED", timeZone: "Asia/Dubai", defaultLanguage: "en", languages: ["en", "ar"] };

beforeAll(async () => {
  admin = await adminClient(); pool = makePool(); W = await seedTenant(admin, "tpl-defaults");
  await saveProfile(pool, A(), { primaryIndustry: "AV_SECURITY", categories: ["AV_SYSTEMS"], ...base }, 0);
  const rec = await recommend(pool, A());
  const r = await activate(pool, A(), rec.templates.map((t) => t.key), randomUUID(), 0);
  if (!r.ok) throw new Error(r.error);
});
afterAll(async () => { await pool.end(); await admin.end(); });

describe("default templates", () => {
  it("uses the built-in General template when nothing better fits and nothing is chosen", async () => {
    const m = await matchTemplate(pool, A(), { category: "CATERING_SERVICE", eventType: "RFQ" });
    expect(m.defaultKey).toBe("GEN_RFQ");
    expect(m.candidates[0]).toMatchObject({ isDefault: true });
    expect(m.ambiguous).toBe(false);
  });
  it("does not override a clear category match with the any-category default", async () => {
    const m = await matchTemplate(pool, A(), { category: "AV_SYSTEMS", eventType: "RFQ" });
    expect(m.candidates[0]!.template.key).toBe("AV_EQUIPMENT_RFQ");
    expect(m.defaultKey).toBeNull();
  });
  it("lets an administrator choose a default for an event type, and only an administrator", async () => {
    expect(await setDefault(pool, as("buyer"), "RFQ", null, "AV_EQUIPMENT_RFQ")).toMatchObject({ ok: false });
    expect(await setDefault(pool, A(), "RFP", null, "AV_EQUIPMENT_RFQ")).toMatchObject({ ok: false });          // wrong event type
    expect(await setDefault(pool, A(), "RFQ", null, "NOT_ENABLED_KEY")).toMatchObject({ ok: false });
    expect(await setDefault(pool, A(), "RFQ", "NOPE", "GEN_RFQ")).toMatchObject({ ok: false });
    expect(await setDefault(pool, A(), "RFQ", null, "GEN_RFQ")).toMatchObject({ ok: true });
    expect(await listDefaults(pool, A())).toEqual([{ eventType: "RFQ", category: "*", templateKey: "GEN_RFQ" }]);
  });
  it("a category default wins over the category match, and can be cleared", async () => {
    expect(await setDefault(pool, A(), "RFQ", "AV_SYSTEMS", "GEN_RFQ")).toMatchObject({ ok: true });
    const m = await matchTemplate(pool, A(), { category: "AV_SYSTEMS", eventType: "RFQ" });
    expect(m.defaultKey).toBe("GEN_RFQ");
    expect(m.candidates[0]!.template.key).toBe("GEN_RFQ");
    expect(m.candidates.map((c) => c.template.key)).toContain("AV_EQUIPMENT_RFQ");        // still offered
    expect(await setDefault(pool, A(), "RFQ", "AV_SYSTEMS", null)).toMatchObject({ ok: true });
    expect((await matchTemplate(pool, A(), { category: "AV_SYSTEMS", eventType: "RFQ" })).defaultKey).toBeNull();
  });
  it("applies a chosen any-category default only where nothing more specific fits", async () => {
    expect(await setDefault(pool, A(), "RFQ", null, "AV_EQUIPMENT_RFQ")).toMatchObject({ ok: true });
    const m = await matchTemplate(pool, A(), { category: "CATERING_SERVICE", eventType: "RFQ" });   // only general templates match here
    expect(m.candidates.map((c) => c.template.key)).not.toContain("AV_EQUIPMENT_RFQ");
    expect(m.defaultKey).toBe("GEN_RFQ");                                                     // the chosen one is not a candidate here, so the built-in applies
  });
  it("is isolated per company and recorded in the audit trail", async () => {
    const other = await seedTenant(admin, "tpl-defaults-2");
    const O: Who = { tenantId: other.tenantId, userId: other.people.admin.userId, membershipId: other.people.admin.membershipId, role: "admin" } as Who;
    expect(await listDefaults(pool, O)).toEqual([]);
    expect((await admin.query(`select count(*)::int n from audit_event where tenant_id = $1 and action like 'template.default_%'`, [W.tenantId])).rows[0].n).toBeGreaterThan(0);
  });
});
