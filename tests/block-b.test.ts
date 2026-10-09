import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBidForm, priceBid, submitBidForm } from "@/bids/service";
import { getCommercialView, openCommercialEnvelopes } from "@/commercial/service";
import type { Who } from "@/events/service";
import type { SupplierWho } from "@/suppliers/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const sw = (i: 0 | 1 | 2): SupplierWho => ({ tenantId: X.tenantId, supplierId: X.suppliers[i].id, supplierUserId: X.suppliers[i].supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });
const who = (p: keyof World["people"]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role: "member" } as Who);
const ver = async (id: string) => (await admin.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "blkb"); });
afterAll(async () => { await pool.end(); await admin.end(); });

async function liveEvent(opts: { lots?: boolean } = {}) {
  const ev = (await admin.query(`insert into sourcing_event (tenant_id, title, state, ref, currency, closes_at) values ($1, 'BOQ', 'draft', $2, 'AED', $3) returning id`, [X.tenantId, "EV-" + randomUUID().slice(0, 8), new Date(Date.now() + 3600_000).toISOString()])).rows[0].id as string;
  const lots: string[] = [];
  if (opts.lots) for (const n of [1, 2]) lots.push((await admin.query(`insert into event_lot (tenant_id, event_id, lot_no, name) values ($1,$2,$3,$4) returning id`, [X.tenantId, ev, n, `Lot ${n}`])).rows[0].id);
  const ids: string[] = [];
  for (const [n, q, t, sec] of [[1, "100", "UNIT_PRICE", "1 Civil > 1.1 Foundations"], [2, "1", "LUMP_SUM", "1 Civil > 1.2 Slabs"], [3, "5", "UNIT_PRICE", "2 Mech"]] as const) {
    const lot = opts.lots ? lots[n === 3 ? 1 : 0] : null;
    ids.push((await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type, section, lot_id) values ($1,$2,$3,'Item',$4,'ea',$5,$6,$7) returning id`, [X.tenantId, ev, n, q, t, sec, lot])).rows[0].id);
  }
  await admin.query(`update sourcing_event set state = 'published' where id = $1`, [ev]);
  for (const i of [0, 1] as const) await admin.query(`insert into invitation (tenant_id, event_id, supplier_id, supplier_user_id, token_hash) values ($1,$2,$3,$4,$5)`, [X.tenantId, ev, X.suppliers[i].id, X.suppliers[i].supplierUserId, randomUUID()]);
  return { ev, ids, lots };
}
const TXT = "We comply with the full specification.";

describe("price breaks", () => {
  it("applies the break at the event quantity, keeps the base price, and round-trips", async () => {
    const { ev, ids } = await liveEvent();
    const prices = { [ids[0]!]: "10", [ids[1]!]: "500", [ids[2]!]: "20" };
    const tiers = { [ids[0]!]: [{ minQty: "50", unitPrice: "9" }, { minQty: "200", unitPrice: "8" }] };
    const r = await submitBidForm(pool, sw(0), ev, { prices, tiers, technicalText: TXT });
    expect(r).toMatchObject({ ok: true, total: "1500.00" });        // 100 x 9 + 500 + 5 x 20
    const f = (await getBidForm(pool, sw(0), ev))!;
    expect(f.prices[ids[0]!]).toBe("10.0000");                      // the base price comes back, not the break
    expect(f.tiers[ids[0]!]).toEqual([{ minQty: "50", unitPrice: "9" }, { minQty: "200", unitPrice: "8" }]);
    const bad = await submitBidForm(pool, sw(0), ev, { prices, tiers: { [ids[0]!]: [{ minQty: "50", unitPrice: "11" }] }, technicalText: TXT });
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining("cheaper") });
    const lump = await submitBidForm(pool, sw(0), ev, { prices, tiers: { [ids[1]!]: [{ minQty: "1", unitPrice: "1" }] }, technicalText: TXT });
    expect(lump).toMatchObject({ ok: false, error: expect.stringContaining("lump sum") });
  });
  it("priceBid returns the applied break on the line", async () => {
    const { ev, ids } = await liveEvent();
    const form = (await getBidForm(pool, sw(0), ev))!;
    const r = priceBid(form.items, { [ids[0]!]: "10", [ids[1]!]: "5", [ids[2]!]: "2" }, [], { [ids[0]!]: [{ minQty: "100", unitPrice: "7.5" }] });
    if (!r.ok) throw new Error(r.error);
    expect(r.lines[0]).toMatchObject({ unitPrice: "7.5000", basePrice: "10.0000", appliedTier: { minQty: "100", unitPrice: "7.5" } });
  });
});

describe("alternates and bundles on the bid", () => {
  it("accepts up to two priced alternates on an event without lots", async () => {
    const { ev, ids } = await liveEvent();
    const prices = { [ids[0]!]: "10", [ids[1]!]: "500", [ids[2]!]: "20" };
    const alt = { label: "Brand B", note: "Uses brand B pumps with a longer warranty.", prices: { [ids[0]!]: "9", [ids[1]!]: "450", [ids[2]!]: "18" } };
    expect(await submitBidForm(pool, sw(0), ev, { prices, technicalText: TXT, alternates: [alt] })).toMatchObject({ ok: true });
    expect((await getBidForm(pool, sw(0), ev))!.alternates[0]).toMatchObject({ label: "Brand B", prices: { [ids[0]!]: "9.0000" } });
    expect(await submitBidForm(pool, sw(0), ev, { prices, technicalText: TXT, alternates: [alt, alt, alt] })).toMatchObject({ ok: false });
    expect(await submitBidForm(pool, sw(0), ev, { prices, technicalText: TXT, alternates: [{ ...alt, note: "short" }] })).toMatchObject({ ok: false });
    expect(await submitBidForm(pool, sw(0), ev, { prices, technicalText: TXT, alternates: [{ ...alt, prices: { [ids[0]!]: "9" } }] })).toMatchObject({ ok: false });
  });
  it("accepts bundle discounts on an event with lots and refuses bad ones", async () => {
    const { ev, ids, lots } = await liveEvent({ lots: true });
    const prices = { [ids[0]!]: "10", [ids[1]!]: "500", [ids[2]!]: "20" };
    const ok = await submitBidForm(pool, sw(0), ev, { prices, technicalText: TXT, bundles: [{ lotIds: lots, discountPct: "5" }] });
    expect(ok).toMatchObject({ ok: true });
    expect((await getBidForm(pool, sw(0), ev))!.bundles).toEqual([{ lotIds: [...lots].sort(), discountPct: "5.00" }]);
    for (const b of [{ lotIds: [lots[0]!], discountPct: "5" }, { lotIds: lots, discountPct: "0" }, { lotIds: lots, discountPct: "60" }]) {
      expect(await submitBidForm(pool, sw(0), ev, { prices, technicalText: TXT, bundles: [b] })).toMatchObject({ ok: false });
    }
    expect(await submitBidForm(pool, sw(0), ev, { prices, technicalText: TXT, alternates: [{ label: "Alt", note: "A different solution here.", prices }] })).toMatchObject({ ok: false });
  });
});

async function commercialEvent(prices: { total: string; alternates?: object[]; lots?: object[]; bundles?: object[] }[]) {
  const e = await makeEvent(admin, X, "technical_approved", { withBids: false });
  await admin.query(`delete from tech_result where event_id = $1`, [e.id]);
  await admin.query(`delete from qualified_bidder where event_id = $1`, [e.id]);
  for (const [i, p] of prices.entries()) {
    const rev = (await admin.query(`insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key) values ($1,$2,$3,1,$4) returning id`, [X.tenantId, e.id, X.suppliers[i]!.id, randomUUID()])).rows[0].id;
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D7','price_lines',$3)`, [X.tenantId, rev, JSON.stringify({ currency: "AED", lines: [], ...p })]);
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D6','technical_response',$3)`, [X.tenantId, rev, JSON.stringify({ text: "tech" })]);
    await admin.query(`insert into tech_result (tenant_id, event_id, supplier_id, total, qualified) values ($1,$2,$3,80,true)`, [X.tenantId, e.id, X.suppliers[i]!.id]);
    await admin.query(`insert into qualified_bidder (tenant_id, event_id, supplier_id) values ($1,$2,$3)`, [X.tenantId, e.id, X.suppliers[i]!.id]);
  }
  await openCommercialEnvelopes(pool, who("buyer"), e.id, await ver(e.id), X.people.witness.membershipId);
  return e.id;
}

describe("alternates and bundles in the comparison", () => {
  it("ranks an alternate as if it replaced the main offer, without changing the real ranking", async () => {
    const id = await commercialEvent([
      { total: "1000.00", alternates: [{ label: "Cheaper brand", note: "Another brand with the same spec.", total: "800.00" }] },
      { total: "900.00" },
    ]);
    const c = (await getCommercialView(pool, who("buyer"), id))!.comparison!;
    expect(c.rows[0]!.supplierId).toBe(X.suppliers[1]!.id);                    // the real ranking ignores the alternate
    expect(c.rows[0]!.total).toBe("900.00");
    expect(c.alternates).toHaveLength(1);
    expect(c.alternates![0]).toMatchObject({ label: "Cheaper brand", total: "800.00", difference: "-200.00", mainRank: 2, rankIfAccepted: 1 });
  });
  it("shows a bundle discount with its saving", async () => {
    const e = await makeEvent(admin, X, "technical_approved", { withBids: false });
    await admin.query(`delete from tech_result where event_id = $1`, [e.id]);
    await admin.query(`delete from qualified_bidder where event_id = $1`, [e.id]);
    const lots: string[] = [];
    await admin.query(`update sourcing_event set state = 'draft' where id = $1`, [e.id]);
    for (const n of [1, 2]) lots.push((await admin.query(`insert into event_lot (tenant_id, event_id, lot_no, name) values ($1,$2,$3,$4) returning id`, [X.tenantId, e.id, n, `Lot ${n}`])).rows[0].id);
    await admin.query(`update sourcing_event set state = 'technical_approved' where id = $1`, [e.id]);
    const rev = (await admin.query(`insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key) values ($1,$2,$3,1,$4) returning id`, [X.tenantId, e.id, X.suppliers[0]!.id, randomUUID()])).rows[0].id;
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D7','price_lines',$3)`, [X.tenantId, rev, JSON.stringify({ currency: "AED", total: "3000.00", lines: [], lots: [{ lotId: lots[0], lotNo: 1, total: "1000.00" }, { lotId: lots[1], lotNo: 2, total: "2000.00" }], bundles: [{ lotIds: lots, lotNos: [1, 2], discountPct: "5.00" }] })]);
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D6','technical_response',$3)`, [X.tenantId, rev, JSON.stringify({ text: "tech" })]);
    await admin.query(`insert into tech_result (tenant_id, event_id, supplier_id, total, qualified) values ($1,$2,$3,80,true)`, [X.tenantId, e.id, X.suppliers[0]!.id]);
    await admin.query(`insert into qualified_bidder (tenant_id, event_id, supplier_id) values ($1,$2,$3)`, [X.tenantId, e.id, X.suppliers[0]!.id]);
    await openCommercialEnvelopes(pool, who("buyer"), e.id, await ver(e.id), X.people.witness.membershipId);
    const c = (await getCommercialView(pool, who("buyer"), e.id))!.comparison!;
    expect(c.bundles).toEqual([expect.objectContaining({ lotNos: [1, 2], discountPct: "5.00", lotsTotal: "3000.00", saving: "150.00", net: "2850.00" })]);
  });
});
