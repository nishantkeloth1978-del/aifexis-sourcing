import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBidForm, priceBid, submitBidForm } from "@/bids/service";
import type { SupplierWho } from "@/suppliers/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (i: 0 | 1 | 2): SupplierWho => ({ tenantId: X.tenantId, supplierId: X.suppliers[i].id, supplierUserId: X.suppliers[i].supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });

async function liveEvent(closesIn = 3600_000) {
  const ev = (await admin.query(
    `insert into sourcing_event (tenant_id, title, state, ref, currency, closes_at) values ($1, 'Pumps', 'draft', $2, 'AED', $3) returning id`,
    [X.tenantId, "EV-" + randomUUID().slice(0, 8), new Date(Date.now() + closesIn).toISOString()])).rows[0].id as string;
  const ids: string[] = [];
  for (const [n, q, t] of [[1, "10", "UNIT_PRICE"], [2, "1", "LUMP_SUM"]] as const) {
    ids.push((await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type) values ($1,$2,$3,'Item',$4,'ea',$5) returning id`, [X.tenantId, ev, n, q, t])).rows[0].id);
  }
  await admin.query(`update sourcing_event set state = 'published' where id = $1`, [ev]);
  for (const i of [0, 1] as const) await admin.query(`insert into invitation (tenant_id, event_id, supplier_id, supplier_user_id, token_hash) values ($1,$2,$3,$4,$5)`, [X.tenantId, ev, X.suppliers[i].id, X.suppliers[i].supplierUserId, randomUUID()]);
  return { ev, ids };
}

beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "bids"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("supplier bids", () => {
  it("prices lines exactly: quantity x price, lump sums as given", async () => {
    const { ev, ids } = await liveEvent();
    const form = (await getBidForm(pool, who(0), ev))!;
    const r = priceBid(form.items, { [ids[0]!]: "12.5", [ids[1]!]: "1000.10" });
    expect(r).toMatchObject({ ok: true, total: "1125.10" });
    expect(priceBid(form.items, { [ids[0]!]: "0", [ids[1]!]: "5" }).ok).toBe(false);
    expect(priceBid(form.items, { [ids[0]!]: "1.23456", [ids[1]!]: "5" }).ok).toBe(false);
  });
  it("submits, revises, and sees only its own latest values", async () => {
    const { ev, ids } = await liveEvent();
    const p = { [ids[0]!]: "10", [ids[1]!]: "50" };
    expect(await submitBidForm(pool, who(0), ev, { prices: p, technicalText: "We comply with the full spec." })).toMatchObject({ ok: true, revisionNo: 1, total: "150.00" });
    expect(await submitBidForm(pool, who(0), ev, { prices: { ...p, [ids[0]!]: "9" }, technicalText: "Revised technical text." })).toMatchObject({ ok: true, revisionNo: 2, total: "140.00" });
    const mine = (await getBidForm(pool, who(0), ev))!;
    expect(mine).toMatchObject({ revisionNo: 2, total: "140.00", technicalText: "Revised technical text." });
    const other = (await getBidForm(pool, who(1), ev))!;
    expect(other).toMatchObject({ revisionNo: 0, total: null, technicalText: "" });
  });
  it("same idempotency key does not create a second revision", async () => {
    const { ev, ids } = await liveEvent(); const key = randomUUID();
    const args = { prices: { [ids[0]!]: "1", [ids[1]!]: "1" }, technicalText: "Technical text here.", idempotencyKey: key };
    const a = await submitBidForm(pool, who(0), ev, args), b = await submitBidForm(pool, who(0), ev, args);
    expect(a).toMatchObject({ ok: true, revisionNo: 1 }); expect(b).toMatchObject({ ok: true, revisionNo: 1, duplicate: true });
  });
  it("refuses uninvited suppliers, closed events, and missing parts", async () => {
    const { ev, ids } = await liveEvent();
    const p = { [ids[0]!]: "1", [ids[1]!]: "1" };
    expect(await getBidForm(pool, who(2), ev)).toBeNull();
    expect(await submitBidForm(pool, who(2), ev, { prices: p, technicalText: "Technical text here." })).toMatchObject({ ok: false });
    expect(await submitBidForm(pool, who(0), ev, { prices: p, technicalText: "short" })).toMatchObject({ ok: false });
    expect(await submitBidForm(pool, who(0), ev, { prices: { [ids[0]!]: "1" }, technicalText: "Technical text here." })).toMatchObject({ ok: false });
    const past = await liveEvent(-1000);
    expect(await submitBidForm(pool, who(0), past.ev, { prices: { [past.ids[0]!]: "1", [past.ids[1]!]: "1" }, technicalText: "Technical text here." })).toMatchObject({ ok: false });
  });
});
