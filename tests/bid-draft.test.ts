import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBidForm, submitBidForm } from "@/bids/service";
import { cleanDraft, discardDraft, saveDraft } from "@/bids/draft";
import type { SupplierWho } from "@/suppliers/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const sup = (i: 0 | 1 | 2): SupplierWho => ({ tenantId: X.tenantId, supplierId: X.suppliers[i].id, supplierUserId: X.suppliers[i].supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "draft"); process.env.DB_RUNTIME_ROLE = "app_supplier"; });
afterAll(async () => { delete process.env.DB_RUNTIME_ROLE; await pool.end(); await admin.end(); });

async function liveEvent(closesInMs = 3600_000) {
  const id = (await admin.query(`insert into sourcing_event (tenant_id, title, state, ref, currency, closes_at) values ($1, 'Pumps', 'draft', $2, 'AED', $3) returning id`,
    [X.tenantId, "EV-" + randomUUID().slice(0, 8), new Date(Date.now() + closesInMs).toISOString()])).rows[0].id as string;
  await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type) values ($1,$2,1,'Item',10,'ea','UNIT_PRICE')`, [X.tenantId, id]);
  await admin.query(`update sourcing_event set state = 'published' where id = $1`, [id]);
  for (const i of [0, 1] as const) await admin.query(`insert into invitation (tenant_id, event_id, supplier_id, supplier_user_id, token_hash) values ($1,$2,$3,$4,$5)`, [X.tenantId, id, X.suppliers[i].id, X.suppliers[i].supplierUserId, randomUUID()]);
  return id;
}

describe("supplier drafts", () => {
  it("a saved draft comes back on the next visit, is private to that supplier, and disappears on submit", async () => {
    const e = await liveEvent();
    const form = (await getBidForm(pool, sup(0), e))!;
    expect(form.draft).toBeNull();
    const itemId = form.items[0]!.id;
    const saved = await saveDraft(pool, sup(0), e, { prices: { [itemId]: "12.5" }, technicalText: "Half written", tiers: {}, gates: {}, answers: {}, alternates: [], bundles: [] });
    expect(saved).toMatchObject({ ok: true });
    const back = (await getBidForm(pool, sup(0), e))!;
    expect(back.draft?.values.prices[itemId]).toBe("12.5");
    expect(back.draft?.values.technicalText).toBe("Half written");
    expect((await getBidForm(pool, sup(1), e))!.draft).toBeNull();
    const sub = await submitBidForm(pool, sup(0), e, { prices: { [itemId]: "12.5" }, technicalText: "We meet the full specification.", gates: Object.fromEntries(form.gates.map((g) => [g, true])) });
    expect(sub).toMatchObject({ ok: true });
    expect((await getBidForm(pool, sup(0), e))!.draft).toBeNull();
    expect((await admin.query(`select 1 from bid_draft where event_id = $1`, [e])).rowCount).toBe(0);
  });
  it("a draft based on an older revision is not offered after a newer submission", async () => {
    const e = await liveEvent();
    const form = (await getBidForm(pool, sup(0), e))!;
    const itemId = form.items[0]!.id;
    await saveDraft(pool, sup(0), e, { prices: { [itemId]: "9" }, technicalText: "", tiers: {}, gates: {}, answers: {}, alternates: [], bundles: [] });
    await admin.query(`update bid_draft set base_revision = 99 where event_id = $1`, [e]);
    expect((await getBidForm(pool, sup(0), e))!.draft).toBeNull();
  });
  it("is refused when the event is closed or the supplier is not invited, and can be discarded", async () => {
    const e = await liveEvent();
    expect(await saveDraft(pool, sup(2), e, { prices: {} })).toMatchObject({ ok: false });
    await saveDraft(pool, sup(0), e, { prices: { a: "1" } });
    ok(await discardDraft(pool, sup(0), e));
    expect((await admin.query(`select 1 from bid_draft where event_id = $1`, [e])).rowCount).toBe(0);
    await admin.query(`update sourcing_event set closes_at = now() - interval '1 minute' where id = $1`, [e]);
    expect(await saveDraft(pool, sup(0), e, { prices: { a: "1" } })).toMatchObject({ ok: false });
  });
  it("keeps only the shapes the form uses and caps their sizes", () => {
    const c = cleanDraft({ prices: { a: "1", b: 5 }, tiers: { a: [{ minQty: "10", unitPrice: "9", evil: "x" }, 1, 2, 3, 4, 5] }, technicalText: 7, gates: { g: true, h: "yes" }, alternates: [1, 2, 3], bundles: "no", extra: "<script>" });
    expect(c.prices).toEqual({ a: "1", b: "" });
    expect(c.tiers.a).toHaveLength(4);
    expect(c.tiers.a![0]).toEqual({ minQty: "10", unitPrice: "9" });
    expect(c.technicalText).toBe("");
    expect(c.gates).toEqual({ g: true });
    expect(c.alternates).toHaveLength(2);
    expect(c.bundles).toEqual([]);
    expect(JSON.stringify(c)).not.toContain("script");
  });
});
const ok = <T,>(r: T): T => { expect(r).toMatchObject({ ok: true }); return r; };
