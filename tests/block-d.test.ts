import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkSubmission, getBidForm, submitBidForm } from "@/bids/service";
import { getCommercialView, openCommercialEnvelopes } from "@/commercial/service";
import type { Who } from "@/events/service";
import type { SupplierWho } from "@/suppliers/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const sw = (i: 0 | 1 | 2): SupplierWho => ({ tenantId: X.tenantId, supplierId: X.suppliers[i].id, supplierUserId: X.suppliers[i].supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });
const who = (p: keyof World["people"]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role: "member" } as Who);
const ver = async (id: string) => (await admin.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "blkd"); });
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

describe("submission check and carry-forward", () => {
  it("reports nothing held before a submission, then the held revision and receipt match", async () => {
    const { ev, ids } = await liveEvent();
    const none = await checkSubmission(pool, sw(0), ev);
    if (!none.ok) throw new Error(none.error);
    expect(none.check).toMatchObject({ held: false, revisionNo: 0, matches: null });
    expect(await submitBidForm(pool, sw(0), ev, { prices: { [ids[0]!]: "10", [ids[1]!]: "500", [ids[2]!]: "20" }, technicalText: TXT })).toMatchObject({ ok: true });
    const f = (await getBidForm(pool, sw(0), ev))!;
    const ok = await checkSubmission(pool, sw(0), ev, ` ${f.fingerprint!.toLowerCase()} `);
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.check).toMatchObject({ held: true, revisionNo: 1, lines: 3, matches: true });
    const wrong = await checkSubmission(pool, sw(0), ev, "0000000000000000");
    if (!wrong.ok) throw new Error(wrong.error);
    expect(wrong.check.matches).toBe(false);
    const other = await checkSubmission(pool, sw(1), ev, f.fingerprint!);          // another bidder's code is not theirs
    if (!other.ok) throw new Error(other.error);
    expect(other.check).toMatchObject({ held: false, matches: false });
    expect(await checkSubmission(pool, sw(0), "not-an-id")).toMatchObject({ ok: false });
  });
  it("carries earlier prices forward and exposes the round number", async () => {
    const { ev, ids } = await liveEvent();
    await submitBidForm(pool, sw(0), ev, { prices: { [ids[0]!]: "10", [ids[1]!]: "500", [ids[2]!]: "20" }, technicalText: TXT });
    const f = (await getBidForm(pool, sw(0), ev))!;
    expect(f.event.roundNo).toBeGreaterThanOrEqual(1);
    expect(f.prices[ids[0]!]).toBe("10.0000");
    expect(f.revisionNo).toBe(1);
  });
});
