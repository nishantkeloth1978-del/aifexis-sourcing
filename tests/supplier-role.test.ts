import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/authz";
import { getBidForm, submitBidForm, checkSubmission } from "@/bids/service";
import { listBidAttachments, uploadBidAttachment, deleteSupplierFile } from "@/files/service";
import { feedbackForSupplier, validityForSupplier } from "@/journey/service";
import * as M from "@/messages/service";
import { handleInbound, parseInbound } from "@/messages/inbound";
import { listNotesForSupplierUser } from "@/notifications/service";
import { laneOf, listInvitedEvents } from "@/suppliers/service";
import type { SupplierWho } from "@/suppliers/service";
import type { Who } from "@/events/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const sup = (i: 0 | 1 | 2): SupplierWho => ({ tenantId: X.tenantId, supplierId: X.suppliers[i].id, supplierUserId: X.suppliers[i].supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });
const staff = (p: keyof World["people"]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role: "member" } as Who);
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "suprole"); });
afterAll(async () => { delete process.env.DB_RUNTIME_ROLE; await pool.end(); await admin.end(); });

/** Runs fn with every database call made as the narrow supplier role, exactly as the supplier deployment does. */
async function asSupplierRole<T>(fn: () => Promise<T>): Promise<T> {
  process.env.DB_RUNTIME_ROLE = "app_supplier";
  try { return await fn(); } finally { delete process.env.DB_RUNTIME_ROLE; }
}
async function liveEvent() {
  const id = (await admin.query(`insert into sourcing_event (tenant_id, title, state, ref, currency, closes_at) values ($1, 'Pumps', 'draft', $2, 'AED', $3) returning id`,
    [X.tenantId, "EV-" + randomUUID().slice(0, 8), new Date(Date.now() + 3600_000).toISOString()])).rows[0].id as string;
  await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type) values ($1,$2,1,'Item',10,'ea','UNIT_PRICE')`, [X.tenantId, id]);
  await admin.query(`update sourcing_event set state = 'published' where id = $1`, [id]);
  for (const i of [0, 1] as const) await admin.query(`insert into invitation (tenant_id, event_id, supplier_id, supplier_user_id, token_hash) values ($1,$2,$3,$4,$5)`, [X.tenantId, id, X.suppliers[i].id, X.suppliers[i].supplierUserId, randomUUID()]);
  await admin.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'buyer')`, [X.tenantId, id, X.people.buyer.membershipId]);
  return { id };
}
const ok = <T,>(r: T): T => { expect(r, JSON.stringify(r)).toMatchObject({ ok: true }); return r; };
const denied = async (sql: string) => {
  const r = await asSupplierRole(() => withTenant(pool, X.tenantId, async (c) => { try { await c.query("savepoint s"); await c.query(sql); return "ran"; } catch (e) { return (e as Error).message; } }));
  return r;
};

describe("the supplier database role", () => {
  it("everything a supplier does still works", async () => {
    const e = await liveEvent();
    await asSupplierRole(async () => {
      expect((await listInvitedEvents(pool, sup(0))).length).toBeGreaterThan(0);
      const form = await getBidForm(pool, sup(0), e.id);
      expect(form).not.toBeNull();
      const prices = Object.fromEntries(form!.items.map((i) => [i.id, "10"]));
      const sub = await submitBidForm(pool, sup(0), e.id, { prices, technicalText: "We meet the full specification.", gates: Object.fromEntries(form!.gates.map((g) => [g, true])) });
      expect(sub, JSON.stringify(sub)).toMatchObject({ ok: true });
      ok(await checkSubmission(pool, sup(0), e.id));
      const mine = (await listInvitedEvents(pool, sup(0))).find((x) => x.id === e.id)!;
      expect(mine.revisionNo).toBe(1);
      expect(mine.submittedAt).not.toBeNull();
      expect(laneOf(mine)).toBe("submitted");
      expect(await feedbackForSupplier(pool, sup(0), e.id)).toBeNull();
      expect(await validityForSupplier(pool, sup(0), e.id)).toBeDefined();
      // files
      const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
      const up = await uploadBidAttachment(pool, sup(0), e.id, "spec.pdf", pdf);
      expect(up).toMatchObject({ ok: true });
      expect((await listBidAttachments(pool, sup(0), e.id)).length).toBe(1);
      if (up.ok) ok(await deleteSupplierFile(pool, sup(0), e.id, up.id));
      // messages
      const q = await M.askBoard(pool, sup(0), e.id, { text: "Is delivery to site included?" });
      expect(q).toMatchObject({ ok: true });
      ok(await M.supplierSend(pool, sup(0), e.id, "A private message to the buyer."));
      const ov = await M.supplierOverview(pool, sup(0), e.id);
      expect(ov).not.toBeNull();
      ok(await M.markSeen(pool, sup(0), e.id, "board"));
      expect(await listNotesForSupplierUser(pool, X.tenantId, X.suppliers[0].supplierUserId)).toBeDefined();
    });
    // the buyer, on the normal role, answers; the supplier role then sees the notice and acknowledges it
    const n = await M.sendNotice(pool, staff("buyer"), e.id, "Site visit is on Sunday at 10:00.");
    expect(n).toMatchObject({ ok: true });
    await asSupplierRole(async () => {
      const ov = await M.supplierOverview(pool, sup(1), e.id);
      expect(ov!.notices.length).toBe(1);
      if (n.ok) ok(await M.acknowledgeNotice(pool, sup(1), e.id, n.id));
    });
  });

  it("translation and reply-by-email also work under the supplier role", async () => {
    const e = await liveEvent();
    process.env.MESSAGES_REPLY_DOMAIN = "reply.test";
    ok(await M.staffReply(pool, staff("buyer"), e.id, X.suppliers[0].id, "Please send your insurance certificate."));
    delete process.env.MESSAGES_REPLY_DOMAIN;
    const mail = (await admin.query(`select to_email, reply_to from email_outbox where event_id = $1 and reply_to is not null order by id desc limit 1`, [e.id])).rows[0];
    await asSupplierRole(async () => {
      const r = await handleInbound(pool, parseInbound({ To: mail.reply_to, From: mail.to_email, TextBody: "Certificate follows tomorrow." }));
      expect(r).toMatchObject({ ok: true });
      const mid = (await admin.query(`select m.id from message m join message_thread t on t.id = m.thread_id where t.event_id = $1 and m.author_kind = 'staff' limit 1`, [e.id])).rows[0].id;
      const fake = (async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: "Translated" }] }) })) as unknown as typeof fetch;
      ok(await M.translateText(pool, { supplier: sup(0) }, e.id, { message: mid }, "ar", { env: { ANTHROPIC_API_KEY: "k" } as unknown as NodeJS.ProcessEnv, fetch: fake }));
    });
  });

  it("cannot read anything that belongs to the buyer side", async () => {
    for (const t of ["tech_score", "tech_result", "approval", "approver_route", "recommendation", "tenant_config", "company_template", "company_override", "company_policy",
      "break_glass_grant", "delegation", "opening_record", "evaluator_declaration", "score_change", "score_moderation", "evaluator_reassignment", "gate_result", "tco_value", "tco_assumption",
      "catalog_item", "audit_event", "handover_log", "event_member_all", "company_pack_assignment", "event_template"]) {
      if (t === "event_member_all") continue;
      expect(await denied(`select 1 from ${t} limit 1`), t).toMatch(/permission denied/);
    }
    expect(await denied(`select role from membership limit 1`)).toMatch(/permission denied/);
    expect(await denied(`select email from app_user where false union all select note from recommendation`)).toMatch(/permission denied/);
    expect(await denied(`select * from event_member limit 1`)).toMatch(/permission denied/);
  });

  it("cannot change buyer-side data", async () => {
    for (const sql of [
      `update sourcing_event set title = 'x'`, `delete from sourcing_event`, `insert into membership (tenant_id, user_id, role) values (current_tenant(), gen_random_uuid(), 'admin')`,
      `update membership set role = 'admin'`, `insert into event_member (tenant_id, event_id, membership_id, event_role) values (current_tenant(), gen_random_uuid(), gen_random_uuid(), 'buyer')`,
      `update invitation set accepted_at = now()`, `delete from bid_revision`, `update supplier_org set name = 'x'`, `insert into tenant_config (tenant_id, version, model) values (current_tenant(), 99, '{}')`,
      `delete from audit_event`, `update audit_event set action = 'x'`, `insert into approval (tenant_id) values (current_tenant())`,
    ]) expect(await denied(sql), sql).toMatch(/permission denied|violates|does not exist/);
  });

  it("row-level security still keeps tenants apart under the supplier role", async () => {
    const Y = await seedTenant(admin, "suprole-other");
    const mine = await asSupplierRole(() => withTenant(pool, X.tenantId, async (c) => (await c.query(`select count(*)::int n from supplier_org where tenant_id = $1`, [Y.tenantId])).rows[0].n));
    expect(mine).toBe(0);
  });
});

describe("supplier workspace lanes", () => {
  it("sorts events by where the supplier stands", () => {
    expect(laneOf({ state: "published", revisionNo: 0 })).toBe("todo");
    expect(laneOf({ state: "published", revisionNo: 2 })).toBe("submitted");
    expect(laneOf({ state: "closed", revisionNo: 1 })).toBe("evaluation");
    expect(laneOf({ state: "commercial_evaluation", revisionNo: 1 })).toBe("evaluation");
    expect(laneOf({ state: "awarded", revisionNo: 1 })).toBe("results");
    expect(laneOf({ state: "cancelled", revisionNo: 0 })).toBe("results");
  });
});
