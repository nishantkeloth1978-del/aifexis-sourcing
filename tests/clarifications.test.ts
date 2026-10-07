import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerQuestion, askQuestion, listForStaff, listForSupplier } from "@/clarifications/service";
import type { Who } from "@/events/service";
import type { SupplierWho } from "@/suppliers/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const staff = (p: keyof World["people"]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role: "member" } as Who);
const sup = (i: 0 | 1 | 2): SupplierWho => ({ tenantId: X.tenantId, supplierId: X.suppliers[i].id, supplierUserId: X.suppliers[i].supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "clar"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("clarifications", () => {
  it("private question, private answer, shared answer without the asker's identity", async () => {
    const e = await makeEvent(admin, X, "published", { withBids: false });
    expect(await askQuestion(pool, sup(0), e.id, "hi")).toMatchObject({ ok: false });
    const q1 = await askQuestion(pool, sup(0), e.id, "Is delivery to site included?");
    const q2 = await askQuestion(pool, sup(1), e.id, "Can we offer an alternative model?");
    expect(q1.ok && q2.ok).toBe(true);
    if (!q1.ok || !q2.ok) return;

    expect((await listForSupplier(pool, sup(2), e.id))).toEqual([]);                       // nobody else sees a private question
    expect(await answerQuestion(pool, staff("techA"), e.id, q1.id, "Yes, included.", false)).toMatchObject({ ok: false });
    expect(await answerQuestion(pool, staff("buyer"), e.id, q1.id, "Yes, delivery is included.", true)).toMatchObject({ ok: true });
    expect(await answerQuestion(pool, staff("buyer"), e.id, q1.id, "Again", true)).toMatchObject({ ok: false });
    expect(await answerQuestion(pool, staff("buyer"), e.id, q2.id, "Alternatives are allowed.", false)).toMatchObject({ ok: true });

    const s0 = await listForSupplier(pool, sup(0), e.id), s1 = await listForSupplier(pool, sup(1), e.id), s2 = await listForSupplier(pool, sup(2), e.id);
    expect(s0).toHaveLength(1); expect(s0[0]!.answer!.body).toContain("delivery is included");
    expect(s1.map((t) => t.question)).toEqual(expect.arrayContaining(["Can we offer an alternative model?", "Is delivery to site included?"]));
    expect(s2).toHaveLength(1); expect(s2[0]).toMatchObject({ fromOthers: true, question: "Is delivery to site included?" });
    expect(JSON.stringify(s2)).not.toMatch(/Alternatives are allowed/);                    // the private answer stays private
    const st = await listForStaff(pool, staff("buyer"), e.id);
    expect(st.canAnswer).toBe(true); expect(st.threads).toHaveLength(2);
    expect((await listForStaff(pool, staff("techA"), e.id)).canAnswer).toBe(false);
  });
  it("closed events take no questions or answers", async () => {
    const e = await makeEvent(admin, X, "closed", { withBids: false });
    await admin.query(`insert into invitation (tenant_id, event_id, supplier_id, token_hash) values ($1,$2,$3,$4) on conflict do nothing`, [X.tenantId, e.id, X.suppliers[0]!.id, randomUUID()]);
    expect(await askQuestion(pool, sup(0), e.id, "Any extension possible?")).toMatchObject({ ok: false });
  });
});
