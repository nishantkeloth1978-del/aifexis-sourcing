import type { Client, Pool } from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Who } from "@/events/service";
import { saveCompanyTemplate } from "@/templates/custom";
import { approvalRequired, decideTemplate, listPendingTemplates, setApprovalRequired } from "@/templates/approval";
import { activate, listLibrary, saveProfile } from "@/templates/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, W: World;
const adm = (p: "admin" | "pubApprover" = "admin"): Who => ({ tenantId: W.tenantId, userId: W.people[p].userId, membershipId: W.people[p].membershipId, role: "admin" } as Who);
const buyer = (): Who => ({ tenantId: W.tenantId, userId: W.people.buyer.userId, membershipId: W.people.buyer.membershipId, role: "member" } as Who);
const meta = { key: "CO_APPR", title: { en: "Approval test", ar: "اختبار الاعتماد" }, category: "SERVICES", eventType: "RFQ" as const };
const mini = (extra = false) => ({
  fields: [{ key: "days", section: "general", label: { en: "Days", ar: "أيام" }, type: "integer", source: "supplier", envelope: "technical", required: true },
    ...(extra ? [{ key: "more", section: "general", label: { en: "More", ar: "المزيد" }, type: "text", source: "supplier", envelope: "technical", required: false }] : [])],
  questions: [], documents: [],
  pricing: { model: "itemized", groups: [{ key: "g", label: { en: "G", ar: "م" }, repeat: true, inputs: [{ key: "q", label: { en: "Q", ar: "ك" }, type: "integer", required: true }] }],
    lines: [{ key: "l", group: "g", description: { en: "Line {name}", ar: "بند {name}" }, quantity: "q", unit: "EA", block: "UNIT_PRICE" }] },
  evaluation: { modes: ["price", "manual"], mode: "price", scale: { min: 0, max: 5 }, criteria: [] },
});
beforeAll(async () => {
  admin = await adminClient(); pool = makePool(); W = await seedTenant(admin, "tpl-appr");
  await saveProfile(pool, adm(), { primaryIndustry: "CONSTRUCTION", categories: ["SERVICES"], country: "ae", currency: "AED", timeZone: "Asia/Dubai", defaultLanguage: "en", languages: ["en", "ar"] }, 0);
});
afterAll(async () => { await pool.end(); await admin.end(); });

describe("policy approval for company templates", () => {
  it("is off by default, admin only, and hides unapproved versions until a different admin approves", async () => {
    expect(await approvalRequired(pool, adm())).toBe(false);
    expect(await setApprovalRequired(pool, buyer(), true)).toMatchObject({ ok: false });
    expect(await saveCompanyTemplate(pool, adm(), meta, mini())).toMatchObject({ ok: true, version: 1 });
    expect(await listPendingTemplates(pool, adm())).toEqual([]);
    expect((await listLibrary(pool, adm())).find((t) => t.key === "CO_APPR")).toMatchObject({ version: 1 });
    expect(await setApprovalRequired(pool, adm(), true)).toMatchObject({ ok: true });
    expect(await saveCompanyTemplate(pool, adm(), meta, mini(true), "adds a field")).toMatchObject({ ok: true, version: 2 });
    expect((await listLibrary(pool, adm())).find((t) => t.key === "CO_APPR")!.version).toBe(1);        // v2 not usable yet
    const p = await listPendingTemplates(pool, adm());
    expect(p).toEqual([expect.objectContaining({ key: "CO_APPR", version: 2, submittedByMe: true, first: false, changes: [expect.objectContaining({ key: "more", kind: "added" })] })]);
    expect(await decideTemplate(pool, adm(), "CO_APPR", 2, true)).toMatchObject({ ok: false });        // not the submitter
    expect(await decideTemplate(pool, adm("pubApprover"), "CO_APPR", 2, false, "no")).toMatchObject({ ok: false });   // reason needed
    expect(await decideTemplate(pool, buyer(), "CO_APPR", 2, true)).toMatchObject({ ok: false });
    expect(await decideTemplate(pool, adm("pubApprover"), "CO_APPR", 2, true)).toMatchObject({ ok: true });
    expect((await listLibrary(pool, adm())).find((t) => t.key === "CO_APPR")!.version).toBe(2);
    expect(await decideTemplate(pool, adm("pubApprover"), "CO_APPR", 2, true)).toMatchObject({ ok: false });          // already decided
    expect(await activate(pool, adm(), ["CO_APPR"], randomUUID(), 0)).toMatchObject({ ok: true });
  });
  it("a rejected version stays unusable", async () => {
    await saveCompanyTemplate(pool, adm(), meta, mini(), "v3");
    expect(await decideTemplate(pool, adm("pubApprover"), "CO_APPR", 3, false, "Wording is wrong")).toMatchObject({ ok: true });
    expect((await listLibrary(pool, adm())).find((t) => t.key === "CO_APPR")!.version).toBe(2);
    expect(await listPendingTemplates(pool, adm())).toEqual([]);
  });
});
