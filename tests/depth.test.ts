import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveTechnical, closeBidding, getEvalView, openTechnicalEnvelopes, saveScores } from "@/evaluation/service";
import { DEFAULT_CONFIG, saveConfig } from "@/config/service";
import { listAwarded, previewPayload, sendHandover } from "@/handover/service";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"], role = "member"): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role } as Who);
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "depth"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("configuration of weights and knockouts", () => {
  it("validates criterion weights and disqualifying declarations", async () => {
    const base = { ...DEFAULT_CONFIG, gates: ["Valid licence", "No sanctions"] };
    expect(await saveConfig(pool, who("admin", "admin"), { ...base, criterionWeights: [50, 50] })).toMatchObject({ ok: false });
    expect(await saveConfig(pool, who("admin", "admin"), { ...base, criterionWeights: [40, 30, 20, 20] })).toMatchObject({ ok: false });
    expect(await saveConfig(pool, who("admin", "admin"), { ...base, knockout: ["Something else"] })).toMatchObject({ ok: false });
    expect(await saveConfig(pool, who("admin", "admin"), { ...base, criterionWeights: [70, 10, 10, 10], knockout: ["Valid licence"] })).toMatchObject({ ok: true });
  });
});

describe("weighted scoring and disqualification", () => {
  it("weights the criteria, flags a failed knockout and refuses to qualify that bidder", async () => {
    const e = await makeEvent(admin, X, "published", { closesAt: new Date(Date.now() - 1000).toISOString(), withBids: false });
    const v = (await admin.query(`select state_version from sourcing_event where id = $1`, [e.id])).rows[0].state_version as number;
    const tech: { supplier_id: string }[] = [];
    for (const [i, sp] of X.suppliers.entries()) {
      const rev = (await admin.query(`insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key, submitted_at) values ($1,$2,$3,1,$4,now() - interval '1 day') returning id`, [X.tenantId, e.id, sp.id, `k${i}${Date.now()}`])).rows[0].id;
      await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D6','technical_response',$3)`, [X.tenantId, rev, JSON.stringify({ text: "Our technical offer", gates: [{ name: "Valid licence", answer: i !== 0 }, { name: "No sanctions", answer: true }] })]);
      tech.push({ supplier_id: sp.id });
    }
    const bad = tech[0]!.supplier_id as string;
    expect(await closeBidding(pool, who("buyer"), e.id, v)).toMatchObject({ ok: true });
    expect(await openTechnicalEnvelopes(pool, who("buyer"), e.id, v + 1, X.people.witness.membershipId)).toMatchObject({ ok: true });
    const view = (await getEvalView(pool, who("techA"), e.id))!;
    expect(view.criterionWeights).toEqual([70, 10, 10, 10]);
    expect(view.bidders!.find((b) => b.supplierId === bad)!.failed).toEqual(["Valid licence"]);
    const score = (n: number, rest: number) => Object.fromEntries(view.criteria.map((k, i) => [k, i === 0 ? n : rest]));
    for (const p of ["techA", "techB"] as const) for (const b of view.bidders!) expect(await saveScores(pool, who(p), e.id, b.supplierId, b.supplierId === bad ? score(10, 10) : score(10, 0))).toMatchObject({ ok: true });
    const av = (await getEvalView(pool, who("techApprover"), e.id))!;
    const row = (id: string) => av.results!.find((r) => r.supplierId === id)!;
    expect(row(bad)).toMatchObject({ total: 100, suggested: false, disqualified: ["Valid licence"] });
    const other = tech[1]!.supplier_id as string;
    expect(row(other)).toMatchObject({ total: 70, suggested: true });   // 10 x 70% of the weight, other criteria zero
    const sv = (await admin.query(`select state_version from sourcing_event where id = $1`, [e.id])).rows[0].state_version as number;
    expect(await approveTechnical(pool, who("techApprover"), e.id, sv, [bad, other])).toMatchObject({ ok: false, error: expect.stringContaining("disqualified") });
    expect(await approveTechnical(pool, who("techApprover"), e.id, sv, [other])).toMatchObject({ ok: true });
  });
});

describe("handover (test mode)", () => {
  it("builds the award payload, records one reference per target, and is limited to the buyer or an admin", async () => {
    const e = await makeEvent(admin, X, "draft", { withBids: true });
    for (const [n, q, t] of [[1, "10", "UNIT_PRICE"], [2, "1", "LUMP_SUM"]] as const)
      await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type) values ($1,$2,$3,$4,$5,'ea',$6)`, [X.tenantId, e.id, n, `Line ${n}`, q, t]);
    await admin.query(`update sourcing_event set state = 'awarded', currency = 'AED' where id = $1`, [e.id]);
    const win = X.suppliers[0].id;
    const rev = (await admin.query(`select id from bid_revision where event_id = $1 and supplier_id = $2`, [e.id, win])).rows[0].id;
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D7','price_lines',$3)`, [X.tenantId, rev,
      JSON.stringify({ lines: [{ lineNo: 1, quantity: "10", unitPrice: "12.5", amount: "125.00" }, { lineNo: 2, quantity: "1", unitPrice: "1000", amount: "1000.00" }], total: "1125.00" })]);
    await admin.query(`insert into recommendation (tenant_id, event_id, supplier_id, note, created_by) values ($1,$2,$3,'Lowest compliant bid.',$4)`, [X.tenantId, e.id, win, X.people.buyer.membershipId]);

    const p = await previewPayload(pool, who("buyer"), e.id, "SAP");
    if (!p.ok) throw new Error(p.error);
    expect(p.payload).toMatchObject({ totalNet: "1125.00", currency: "AED" });
    expect(p.payload.items.map((i) => [i.lineNo, i.unitPrice, i.netAmount])).toEqual([[1, "12.5", "125.00"], [2, "1000", "1000.00"]]);
    expect(await previewPayload(pool, who("techA"), e.id, "SAP")).toMatchObject({ ok: false });
    expect(await sendHandover(pool, who("techA"), e.id, "SAP")).toMatchObject({ ok: false });
    const a = await sendHandover(pool, who("buyer"), e.id, "SAP");
    expect(a).toMatchObject({ ok: true, duplicate: false }); if (!a.ok) return;
    expect(a.reference).toMatch(/^MOCK-SAP-\d{10}$/);
    expect(await sendHandover(pool, who("buyer"), e.id, "SAP")).toMatchObject({ ok: true, duplicate: true, reference: a.reference });
    expect(await sendHandover(pool, who("admin", "admin"), e.id, "ARIBA")).toMatchObject({ ok: true, duplicate: false });
    expect((await admin.query(`select 1 from handover_log where event_id = $1`, [e.id])).rowCount).toBe(2);
    const list = await listAwarded(pool, who("buyer"));
    expect(list.find((r) => r.id === e.id)).toMatchObject({ vendor: expect.any(String), total: "1125.00", last: { status: "sent" } });
    expect(await sendHandover(pool, who("buyer"), (await makeEvent(admin, X, "published")).id, "SAP")).toMatchObject({ ok: false });
  });
});
