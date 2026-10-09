import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_TEMPLATES, TEMPLATES_4 } from "../src/templates/packs";
import { validateContent } from "../src/templates/validate";
import type { Who } from "@/events/service";
import { activate, saveProfile } from "@/templates/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, W: World;
const adm = (): Who => ({ tenantId: W.tenantId, userId: W.people.admin.userId, membershipId: W.people.admin.membershipId, role: "admin" } as Who);
beforeAll(async () => { admin = await adminClient(); pool = makePool(); W = await seedTenant(admin, "tpl-30"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("thirty templates", () => {
  it("adds five new scenarios to existing packs, none clashing with the first 25", () => {
    expect(ALL_TEMPLATES).toHaveLength(25);
    expect(TEMPLATES_4).toHaveLength(5);
    const keys = new Set(ALL_TEMPLATES.map((t) => t.meta.key));
    for (const t of TEMPLATES_4) expect(keys.has(t.meta.key)).toBe(false);
    const sql = readFileSync("supabase/migrations/0036_templates_30.sql", "utf8");
    for (const t of TEMPLATES_4) expect(sql).toContain(`'${t.meta.key}'`);
  });
  it.each(TEMPLATES_4.map((t) => [t.meta.key, t] as const))("%s is valid", (_k, t) => {
    const sections = ["general", "technical", "commercial", "equipment", "service", "warranty", "mobilisation"];
    expect(validateContent({ ...t.content, sections: sections.map((key) => ({ key, label: { en: key, ar: key } })) } as never)).toEqual([]);
    expect(t.version).toBe(1);
  });
  it("the database holds 30 platform templates and a company can enable the new ones", async () => {
    expect((await admin.query(`select count(*)::int n from template_definition where key !~ '^(TEST|ZZ)'`)).rows[0].n).toBe(30);
    await saveProfile(pool, adm(), { primaryIndustry: "CONSTRUCTION", categories: ["CONSTRUCTION_WORKS"], country: "ae", currency: "AED", timeZone: "Asia/Dubai", defaultLanguage: "en", languages: ["en", "ar"] }, 0);
    const r = await activate(pool, adm(), TEMPLATES_4.map((t) => t.meta.key), randomUUID(), 0);
    if (!r.ok) console.log(JSON.stringify(r));
    expect(r).toMatchObject({ ok: true });
  });
});
