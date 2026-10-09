import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Who } from "@/events/service";
import { createEventFromTemplate } from "@/templates/events";
import { configHistory, diffContent, listOverrides, listUpdates, previewEffective, removeOverride, rollbackTo } from "@/templates/lifecycle";
import { activate, activeConfig, addOverride, saveProfile } from "@/templates/service";
import { TEMPLATES_3 } from "@/templates/packs";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, W: World;
const adminOf = (): Who => ({ tenantId: W.tenantId, userId: W.people.admin.userId, membershipId: W.people.admin.membershipId, role: "admin" } as Who);
const buyer = (): Who => ({ tenantId: W.tenantId, userId: W.people.buyer.userId, membershipId: W.people.buyer.membershipId, role: "member" } as Who);
const key = () => randomUUID();
beforeAll(async () => {
  admin = await adminClient(); pool = makePool(); W = await seedTenant(admin, "tpl-life");
  await saveProfile(pool, adminOf(), { primaryIndustry: "IT_SOFTWARE", categories: ["IT_SOFTWARE"], country: "ae", currency: "AED", timeZone: "Asia/Dubai", defaultLanguage: "en", languages: ["en", "ar"] }, 0);
  const base = JSON.parse(JSON.stringify(TEMPLATES_3.find((t) => t.meta.key === "GEN_RFI")!.content));
  base.fields.push({ key: "extra_note", section: "general", label: { en: "Extra note", ar: "ملاحظة إضافية" }, type: "text", source: "supplier", envelope: "technical", required: false });
  await admin.query(`insert into template_version (template_key, version, status, content, content_hash, requires, change_note, published_at) values ('GEN_RFI', 3, 'published', $1::jsonb, 'life-v2', '{rfx}', 'adds a note', now()) on conflict do nothing`, [JSON.stringify(base)]);
});
afterAll(async () => { await pool.end(); await admin.end(); });

describe("template versions, adoption and rollback", () => {
  it("diffs two versions in buyer terms", () => {
    const v1 = TEMPLATES_3.find((t) => t.meta.key === "GEN_RFI")!.content;
    const v2 = { ...v1, fields: [...v1.fields, { ...v1.fields[0] ?? { key: "x", section: "general", type: "text", source: "supplier", envelope: "technical" }, key: "extra_note", label: { en: "Extra note", ar: "ملاحظة" } }] } as typeof v1;
    expect(diffContent(v1, v2)).toEqual([expect.objectContaining({ collection: "fields", key: "extra_note", kind: "added" })]);
    expect(diffContent(v1, v1)).toEqual([]);
  });
  it("keeps the pinned version until the administrator adopts the new one; rollback restores it as a new version", async () => {
    let r = await activate(pool, adminOf(), ["GEN_RFI"], key(), 0);
    expect(r).toMatchObject({ ok: true, version: 1 });
    expect((await activeConfig(pool, adminOf()))!.templates).toEqual([{ key: "GEN_RFI", version: 3 }]);                    // first enablement takes the latest
    await admin.query(`update company_pack_assignment set pinned_version = 2 where tenant_id = $1`, [W.tenantId]);          // simulate a company that enabled it before v2 existed
    r = await activate(pool, adminOf(), ["GEN_RFI"], key(), 1);
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect((await activeConfig(pool, adminOf()))!.templates).toEqual([{ key: "GEN_RFI", version: 2 }]);                    // re-saving does not silently upgrade
    const up = await listUpdates(pool, adminOf());
    expect(up).toEqual([expect.objectContaining({ key: "GEN_RFI", pinned: 2, latest: 3, changes: [expect.objectContaining({ key: "extra_note", kind: "added" })] })]);
    const old = await createEventFromTemplate(pool, buyer(), { templateKey: "GEN_RFI", title: "On v1", idempotencyKey: key() });
    expect(old).toMatchObject({ ok: true });
    expect((await admin.query(`select template_version from sourcing_event where title = 'On v1' and tenant_id = $1`, [W.tenantId])).rows[0].template_version).toBe(2);

    r = await activate(pool, adminOf(), ["GEN_RFI"], key(), 2, "adopt update", ["GEN_RFI"]);
    expect(r).toMatchObject({ ok: true, version: 3 });
    expect((await activeConfig(pool, adminOf()))!.templates).toEqual([{ key: "GEN_RFI", version: 3 }]);
    expect(await listUpdates(pool, adminOf())).toEqual([]);
    await createEventFromTemplate(pool, buyer(), { templateKey: "GEN_RFI", title: "On v2", idempotencyKey: key() });
    expect((await admin.query(`select template_version from sourcing_event where title = 'On v2' and tenant_id = $1`, [W.tenantId])).rows[0].template_version).toBe(3);
    expect((await admin.query(`select template_version from sourcing_event where title = 'On v1' and tenant_id = $1`, [W.tenantId])).rows[0].template_version).toBe(2);   // existing event untouched

    expect(await rollbackTo(pool, buyer(), 2, key(), 3)).toMatchObject({ ok: false });                                       // admin only
    expect(await rollbackTo(pool, adminOf(), 2, key(), 2)).toMatchObject({ ok: false, conflict: true });                     // stale
    expect(await rollbackTo(pool, adminOf(), 3, key(), 3)).toMatchObject({ ok: false });                                     // already active
    const k = key();
    expect(await rollbackTo(pool, adminOf(), 2, k, 3)).toMatchObject({ ok: true, version: 4, duplicate: false });
    expect(await rollbackTo(pool, adminOf(), 2, k, 3)).toMatchObject({ ok: true, version: 4, duplicate: true });           // idempotent
    expect((await activeConfig(pool, adminOf()))!.templates).toEqual([{ key: "GEN_RFI", version: 2 }]);
    const h = await configHistory(pool, adminOf());
    expect(h.map((x) => [x.version, x.status])).toEqual([[4, "active"], [3, "superseded"], [2, "superseded"], [1, "superseded"]]);
    expect(h[0]!.reason).toBe("Rollback to version 2");
  });
});

describe("company customisation", () => {
  it("previews the effective template, applies overrides after activation, and removes them again", async () => {
    const before = await previewEffective(pool, adminOf(), "GEN_RFI");
    expect(before!.effective.questions.find((q) => q.key === "capability")!.label.en).toBe("Describe what you can offer for this need.");
    const o = await addOverride(pool, adminOf(), { templateKey: "GEN_RFI", collection: "questions", objectKey: "capability", op: "update", value: { label: { en: "What can you offer us?", ar: "ماذا يمكنكم أن تقدموا لنا؟" } } });
    if (!o.ok) throw new Error(o.error);
    expect((await previewEffective(pool, adminOf(), "GEN_RFI"))!.effective.questions.find((q) => q.key === "capability")!.label.en).toBe("What can you offer us?");
    expect(await listOverrides(pool, adminOf(), "GEN_RFI")).toEqual([expect.objectContaining({ id: o.id, objectKey: "capability", op: "update" })]);
    const cur = (await activeConfig(pool, adminOf()))!.version;
    expect(await activate(pool, adminOf(), ["GEN_RFI"], key(), cur)).toMatchObject({ ok: true });
    const e = await createEventFromTemplate(pool, buyer(), { templateKey: "GEN_RFI", title: "Custom wording", idempotencyKey: key() });
    if (!e.ok) throw new Error(e.error);
    const eff = (await admin.query(`select template_effective from sourcing_event where id = $1`, [e.event.id])).rows[0].template_effective;
    expect(eff.questions.find((q: { key: string }) => q.key === "capability").label.en).toBe("What can you offer us?");
    expect(await removeOverride(pool, buyer(), o.id)).toMatchObject({ ok: false });
    expect(await removeOverride(pool, adminOf(), o.id)).toMatchObject({ ok: true });
    expect(await removeOverride(pool, adminOf(), o.id)).toMatchObject({ ok: false });
    expect((await previewEffective(pool, adminOf(), "GEN_RFI"))!.effective.questions.find((q) => q.key === "capability")!.label.en).toBe("Describe what you can offer for this need.");
  });
});
