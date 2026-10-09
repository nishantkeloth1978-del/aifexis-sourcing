import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Who } from "@/events/service";
import { createEventFromTemplate, previewRefresh, refreshFromTemplate } from "@/templates/events";
import { activate, saveProfile } from "@/templates/service";
import { TEMPLATES_3 } from "@/templates/packs";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, W: World;
const adminOf = (): Who => ({ tenantId: W.tenantId, userId: W.people.admin.userId, membershipId: W.people.admin.membershipId, role: "admin" } as Who);
const buyer = (): Who => ({ tenantId: W.tenantId, userId: W.people.buyer.userId, membershipId: W.people.buyer.membershipId, role: "member" } as Who);
const key = () => randomUUID();
beforeAll(async () => {
  admin = await adminClient(); pool = makePool(); W = await seedTenant(admin, "tpl-refresh");
  await saveProfile(pool, adminOf(), { primaryIndustry: "IT_SOFTWARE", categories: ["IT_SOFTWARE"], country: "ae", currency: "AED", timeZone: "Asia/Dubai", defaultLanguage: "en", languages: ["en", "ar"] }, 0);
  const base = JSON.parse(JSON.stringify(TEMPLATES_3.find((t) => t.meta.key === "GEN_RFI")!.content));
  base.fields.push({ key: "refresh_note", section: "general", label: { en: "Refresh note", ar: "ملاحظة التحديث" }, type: "text", source: "supplier", envelope: "technical", required: false });
  await admin.query(`insert into template_version (template_key, version, status, content, content_hash, requires, change_note, published_at) values ('GEN_RFI', 5, 'published', $1::jsonb, 'refresh-v5', '{rfx}', 'adds a note', now()) on conflict do nothing`, [JSON.stringify(base)]);
});
afterAll(async () => { await pool.end(); await admin.end(); });

describe("refresh from template", () => {
  it("shows the diff, refreshes a draft, and refuses once it is not a draft", async () => {
    expect(await activate(pool, adminOf(), ["GEN_RFI"], key(), 0)).toMatchObject({ ok: true });
    await admin.query(`update company_pack_assignment set pinned_version = 1 where tenant_id = $1`, [W.tenantId]);
    expect(await activate(pool, adminOf(), ["GEN_RFI"], key(), 1)).toMatchObject({ ok: true, version: 2 });
    const e = await createEventFromTemplate(pool, buyer(), { templateKey: "GEN_RFI", title: "Refresh me", idempotencyKey: key() });
    if (!e.ok) throw new Error(e.error);
    const p0 = await previewRefresh(pool, buyer(), e.event.id);
    if (!p0.ok) throw new Error(p0.error);
    expect(p0.preview.available).toBe(false);
    expect(await activate(pool, adminOf(), ["GEN_RFI"], key(), 2, "adopt", ["GEN_RFI"])).toMatchObject({ ok: true });
    const p1 = await previewRefresh(pool, buyer(), e.event.id);
    if (!p1.ok) throw new Error(p1.error);
    expect(p1.preview.available).toBe(true);
    expect(p1.preview.changes.some((c) => c.key === "refresh_note" && c.kind === "added")).toBe(true);
    const r = await refreshFromTemplate(pool, buyer(), e.event.id);
    expect(r).toMatchObject({ ok: true });
    const row = (await admin.query(`select template_version, template_effective from sourcing_event where id = $1`, [e.event.id])).rows[0];
    expect(row.template_version).toBeGreaterThan(1);
    expect(row.template_effective.fields.some((f: { key: string }) => f.key === "refresh_note")).toBe(true);
    const p2 = await previewRefresh(pool, buyer(), e.event.id);
    if (!p2.ok) throw new Error(p2.error);
    expect(p2.preview.available).toBe(false);
    await admin.query(`update sourcing_event set template_frozen_at = now() where id = $1`, [e.event.id]);
    expect(await refreshFromTemplate(pool, buyer(), e.event.id)).toMatchObject({ ok: false });
  });
});
