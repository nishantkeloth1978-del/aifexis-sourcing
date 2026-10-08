import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoClose, flushOutbox, sendReminders } from "@/automation/service";
import { sendMail } from "@/automation/mailer";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "auto"); });
afterAll(async () => { await pool.end(); await admin.end(); });

async function published(closesAtMs: number, invite = true) {
  const ev = (await admin.query(`insert into sourcing_event (tenant_id, title, state, ref, currency, closes_at) values ($1,'T','draft',$2,'AED',$3) returning id`,
    [X.tenantId, "EV-" + randomUUID().slice(0, 8), new Date(Date.now() + closesAtMs).toISOString()])).rows[0].id as string;
  await admin.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit) values ($1,$2,1,'x',1,'ea')`, [X.tenantId, ev]);
  await admin.query(`update sourcing_event set state = 'published' where id = $1`, [ev]);
  await admin.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'buyer')`, [X.tenantId, ev, X.people.buyer.membershipId]);
  if (invite) await admin.query(`insert into invitation (tenant_id, event_id, supplier_id, supplier_user_id, token_hash) values ($1,$2,$3,$4,$5)`, [X.tenantId, ev, X.suppliers[0].id, X.suppliers[0].supplierUserId, randomUUID()]);
  return ev;
}
const stateOf = async (id: string) => (await admin.query(`select state::text s from sourcing_event where id = $1`, [id])).rows[0].s as string;

describe("automation", () => {
  it("closes events past their closing time, only those, and tells the buyer", async () => {
    const late = await published(-60_000, false), later = await published(3600_000 * 48, false);
    expect(await autoClose(pool, X.tenantId)).toBeGreaterThanOrEqual(1);
    expect(await stateOf(late)).toBe("closed"); expect(await stateOf(later)).toBe("published");
    const n = await admin.query(`select 1 from notification where event_id = $1 and kind = 'auto_closed'`, [late]);
    expect(n.rowCount).toBe(1);
    expect(await autoClose(pool, X.tenantId)).toBe(0);
    expect((await admin.query(`select 1 from audit_event where event_id = $1 and action like '%CloseEvent%'`, [late])).rowCount).toBeGreaterThan(0);
  });
  it("sends one reminder per supplier, skips those who already bid, and queues an e-mail", async () => {
    const soon = await published(3600_000 * 2);
    expect(await sendReminders(pool, X.tenantId)).toBeGreaterThanOrEqual(1);
    expect((await admin.query(`select 1 from notification where event_id = $1 and kind = 'closing_soon'`, [soon])).rowCount).toBe(1);
    expect((await admin.query(`select 1 from email_outbox where event_id = $1`, [soon])).rowCount).toBe(1);
    await sendReminders(pool, X.tenantId);
    expect((await admin.query(`select 1 from notification where event_id = $1 and kind = 'closing_soon'`, [soon])).rowCount).toBe(1);
    const bid = await published(3600_000 * 3);
    await admin.query(`insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key) values ($1,$2,$3,1,'k')`, [X.tenantId, bid, X.suppliers[0].id]);
    await sendReminders(pool, X.tenantId);
    expect((await admin.query(`select 1 from notification where event_id = $1 and kind = 'closing_soon'`, [bid])).rowCount).toBe(0);
  });
  it("flushes the outbox, retries failures and stops after 5 attempts", async () => {
    const sent: string[] = [];
    const r1 = await flushOutbox(pool, X.tenantId, async (to) => { sent.push(to); return { ok: true, mode: "logged" }; });
    expect(r1.sent).toBeGreaterThan(0); expect(sent[0]).toContain("@");
    await admin.query(`insert into email_outbox (tenant_id, to_email, subject, body) values ($1,'a@x.com','s','b')`, [X.tenantId]);
    for (let i = 0; i < 5; i++) await flushOutbox(pool, X.tenantId, async () => ({ ok: false, error: "down" }));
    const row = (await admin.query(`select status, attempts from email_outbox where to_email = 'a@x.com'`)).rows[0];
    expect(row).toMatchObject({ status: "failed", attempts: 5 });
    expect((await flushOutbox(pool, X.tenantId, async () => ({ ok: true, mode: "sent" }))).sent).toBe(0);
  });
  it("mailer only logs without credentials and calls Resend with them", async () => {
    delete process.env.RESEND_API_KEY; delete process.env.MAIL_FROM;
    expect(await sendMail("a@x.com", "s", "b")).toEqual({ ok: true, mode: "logged" });
    process.env.RESEND_API_KEY = "k"; process.env.MAIL_FROM = "Aifexis <n@x.com>";
    let seen: { url: string; auth: string | null } | undefined;
    const f = (async (url: string, init: RequestInit) => { seen = { url, auth: new Headers(init.headers).get("authorization") }; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    expect(await sendMail("a@x.com", "s", "b", f)).toEqual({ ok: true, mode: "sent" });
    expect(seen).toEqual({ url: "https://api.resend.com/emails", auth: "Bearer k" });
    expect(await sendMail("a@x.com", "s", "b", (async () => new Response("no", { status: 500 })) as unknown as typeof fetch)).toMatchObject({ ok: false });
    delete process.env.RESEND_API_KEY; delete process.env.MAIL_FROM;
  });
});
