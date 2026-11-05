import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTransition, withTenant } from "@/authz";
import { getBidForm } from "@/bids/service";
import type { SupplierWho } from "@/suppliers/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const sup = (): SupplierWho => ({ tenantId: X.tenantId, supplierId: X.suppliers[0].id, supplierUserId: X.suppliers[0].supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "envmode"); });
afterAll(async () => { delete process.env.DB_RUNTIME_ROLE; await pool.end(); await admin.end(); });

async function publish(envelopes: "two" | "single") {
  await admin.query(`insert into tenant_config (tenant_id, version, model) values ($1, (select coalesce(max(version), 0) + 1 from tenant_config where tenant_id = $1), $2)`, [X.tenantId, JSON.stringify({ evaluation: { criteria: ["A"], weights: { technical: 30, commercial: 70 }, qualifyAt: 70, closeMargin: 2, opening: { mode: "buyer", envelopes } } })]);
  const id = (await admin.query(`insert into sourcing_event (tenant_id, title, state, ref, currency, closes_at) values ($1, 'AV', 'draft', $2, 'AED', now() + interval '1 day') returning id`, [X.tenantId, "EV-" + randomUUID().slice(0, 8)])).rows[0].id as string;
  await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type) values ($1,$2,1,'Item',10,'ea','UNIT_PRICE')`, [X.tenantId, id]);
  await admin.query(`update sourcing_event set state = 'pending_publication' where id = $1`, [id]);
  await admin.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'publication_approver')`, [X.tenantId, id, X.people.pubApprover.membershipId]);
  await admin.query(`insert into invitation (tenant_id, event_id, supplier_id, supplier_user_id, token_hash) values ($1,$2,$3,$4,$5)`, [X.tenantId, id, X.suppliers[0].id, X.suppliers[0].supplierUserId, randomUUID()]);
  const actor = { kind: "internal" as const, userId: X.people.pubApprover.userId, tenantId: X.tenantId };
  const r = await withTenant(pool, X.tenantId, (c) => applyTransition(c, actor, id, "ApprovePublication", { expectedVersion: 0 }));
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  return id;
}

describe("the supplier's bid form knows how the envelopes open", () => {
  it("freezes the setting at publication and shows only that one fact to the supplier", async () => {
    const one = await publish("single"), two = await publish("two");
    expect((await admin.query(`select envelope_mode from sourcing_event where id = $1`, [one])).rows[0].envelope_mode).toBe("single");
    process.env.DB_RUNTIME_ROLE = "app_supplier";
    expect((await getBidForm(pool, sup(), one))?.envelopes).toBe("single");
    expect((await getBidForm(pool, sup(), two))?.envelopes).toBe("two");
  });
});
