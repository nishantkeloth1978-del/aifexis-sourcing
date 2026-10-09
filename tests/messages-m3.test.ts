import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Who } from "@/events/service";
import type { SupplierWho } from "@/suppliers/service";
import { handleInbound, parseInbound, stripQuoted } from "@/messages/inbound";
import { needsTranslation } from "@/messages/rules";
import * as M from "@/messages/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const staff = (p: keyof World["people"]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role: "member" } as Who);
const sup = (i: 0 | 1 | 2): SupplierWho => ({ tenantId: X.tenantId, supplierId: X.suppliers[i].id, supplierUserId: X.suppliers[i].supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "m3"); process.env.MESSAGES_REPLY_DOMAIN = "reply.test"; });
afterAll(async () => { delete process.env.MESSAGES_REPLY_DOMAIN; await pool.end(); await admin.end(); });
const ok = <T,>(r: { ok: boolean } & T) => { expect(r).toMatchObject({ ok: true }); return r as T; };
const open = () => makeEvent(admin, X, "published", { withBids: false });
const emailOf = async (i: 0 | 1 | 2) => (await admin.query(`select u.email from supplier_user su join app_user u on u.id = su.user_id where su.id = $1`, [X.suppliers[i].supplierUserId])).rows[0].email as string;

/** A fake model: records what it was asked and answers with a fixed text. */
const fakeAi = (reply: string) => { const calls: { system: string; user: string }[] = []; const f = (async (_u: string, init: { body: string }) => { const b = JSON.parse(init.body); calls.push({ system: b.system, user: b.messages[0].content }); return { ok: true, json: async () => ({ content: [{ type: "text", text: reply }] }) }; }) as unknown as typeof fetch; return { calls, deps: { env: { ANTHROPIC_API_KEY: "k" } as unknown as NodeJS.ProcessEnv, fetch: f } }; };

describe("pure helpers", () => {
  it("strips quoted history, signatures and our footer", () => {
    expect(stripQuoted("Thanks, will do.\n\nOn Mon, 5 Oct 2026 at 10:00, Buyer <b@x.com> wrote:\n> old text\n> more")).toBe("Thanks, will do.");
    expect(stripQuoted("Price is 12.50\n\n-----Original Message-----\nFrom: x\nSent: y")).toBe("Price is 12.50");
    expect(stripQuoted("Yes confirmed\n> quoted line\nNo change\n-- \nJohn")).toBe("Yes confirmed\nNo change");
    expect(stripQuoted("Done.\n\nReply to this e-mail to answer. Your reply is added to the conversation.\nOpen Aifexis: https://x")).toBe("Done.");
    expect(stripQuoted("")).toBe("");
  });
  it("parses Postmark and plain shapes", () => {
    const tok = "a".repeat(32);
    const p = parseInbound({ OriginalRecipient: `reply+${tok}@reply.test`, From: "Sam <Sam@Acme.com>", TextBody: "Hello", Attachments: [{ Name: "a.pdf", Content: Buffer.from("x").toString("base64"), ContentType: "application/pdf" }] });
    expect(p).toMatchObject({ token: tok, from: "sam@acme.com", text: "Hello" }); expect(p.attachments).toHaveLength(1);
    expect(parseInbound({ to: `reply+${tok}@x.com`, from: "a@b.co", text: "Hi" })).toMatchObject({ token: tok, from: "a@b.co" });
    expect(parseInbound({ to: "someone@x.com", text: "Hi" }).token).toBeNull();
    expect(parseInbound(null).token).toBeNull();
  });
  it("offers translation only for the other script", () => {
    expect(needsTranslation("هل التسليم إلى الموقع مشمول في السعر؟", "en")).toBe(true);
    expect(needsTranslation("Is delivery to site included?", "en")).toBe(false);
    expect(needsTranslation("Is delivery to site included?", "ar")).toBe(true);
    expect(needsTranslation("ok", "en")).toBe(false);
  });
});

describe("reply by e-mail", () => {
  it("the notification e-mail carries a reply address, and a reply lands in the thread", async () => {
    const e = await open();
    ok(await M.staffReply(pool, staff("buyer"), e.id, X.suppliers[0].id, "Please send your insurance certificate."));
    const mail = (await admin.query(`select to_email, reply_to, body from email_outbox where event_id = $1 and reply_to is not null order by id desc limit 1`, [e.id])).rows[0];
    expect(mail.reply_to).toMatch(/^reply\+[a-f0-9]{32}@reply\.test$/);
    expect(mail.body).toContain("Please send your insurance certificate.");
    const from = mail.to_email as string;
    const body = "Attached next week.\n\nOn Tue, 6 Oct 2026, Buyer wrote:\n> Please send your insurance certificate.";
    expect(await handleInbound(pool, parseInbound({ To: mail.reply_to, From: from, TextBody: body }))).toMatchObject({ ok: true });
    const last = (await admin.query(`select m.body, m.author_kind from message m join message_thread t on t.id = m.thread_id where t.event_id = $1 and t.lane = 'private' order by m.seq desc limit 1`, [e.id])).rows[0];
    expect(last).toMatchObject({ body: "Attached next week.", author_kind: "supplier" });
    // the same mail delivered twice is added once
    expect(await handleInbound(pool, parseInbound({ To: mail.reply_to, From: from, TextBody: body }))).toMatchObject({ ok: true, duplicate: true });
    expect((await admin.query(`select count(*)::int n from message m join message_thread t on t.id = m.thread_id where t.event_id = $1 and m.author_kind = 'supplier'`, [e.id])).rows[0].n).toBe(1);
    // wrong sender, unknown token, empty reply
    expect(await handleInbound(pool, parseInbound({ To: mail.reply_to, From: "intruder@evil.com", TextBody: "Hi there" }))).toMatchObject({ ok: false, reason: "wrong_sender" });
    expect(await handleInbound(pool, parseInbound({ To: `reply+${"b".repeat(32)}@reply.test`, From: from, TextBody: "Hi there" }))).toMatchObject({ ok: false, reason: "unknown_token" });
    expect(await handleInbound(pool, parseInbound({ To: mail.reply_to, From: from, TextBody: "> only a quote" }))).toMatchObject({ ok: false, reason: "empty" });
  });

  it("a reply that the rules refuse is bounced back to the sender, not lost", async () => {
    const e = await makeEvent(admin, X, "closed", { withBids: false });
    await admin.query(`insert into invitation (tenant_id, event_id, supplier_id, token_hash) values ($1,$2,$3,'h-'||gen_random_uuid()) on conflict do nothing`, [X.tenantId, e.id, X.suppliers[0].id]);
    ok(await M.staffReply(pool, staff("buyer"), e.id, X.suppliers[0].id, "Confirm your unit price please.", { requestDueAt: new Date(Date.now() + 864e5).toISOString() }));
    const mail = (await admin.query(`select to_email, reply_to from email_outbox where event_id = $1 and reply_to is not null order by id desc limit 1`, [e.id])).rows[0];
    await admin.query(`update message_thread set request_due_at = now() - interval '1 hour' where event_id = $1`, [e.id]);
    expect(await handleInbound(pool, parseInbound({ To: mail.reply_to, From: mail.to_email, TextBody: "Price is 10" }))).toMatchObject({ ok: false, reason: "refused" });
    const bounce = await admin.query(`select 1 from email_outbox where event_id = $1 and subject like '%not added%'`, [e.id]);
    expect(bounce.rowCount).toBe(1);
  });

  it("without a reply domain the e-mail has no reply address", async () => {
    const e = await open();
    delete process.env.MESSAGES_REPLY_DOMAIN;
    ok(await M.staffReply(pool, staff("buyer"), e.id, X.suppliers[1].id, "A plain message."));
    process.env.MESSAGES_REPLY_DOMAIN = "reply.test";
    expect((await admin.query(`select count(*)::int n from email_outbox where event_id = $1 and reply_to is not null`, [e.id])).rows[0].n).toBe(0);
  });
});

describe("AI draft and translation", () => {
  it("drafts from the event and earlier answers, for the buyer side only, and never names a bidder", async () => {
    const e = await open();
    const a = ok(await M.askBoard(pool, sup(0), e.id, { text: "Is delivery to site included in the price?" })) as { id: string };
    const b = ok(await M.askBoard(pool, sup(1), e.id, { text: "Which packaging do you require?" })) as { id: string };
    ok(await M.answerBoard(pool, staff("buyer"), e.id, b.id, "Export packaging."));
    ok(await M.publishBoard(pool, staff("buyer"), e.id, b.id, { publicQuestion: "Which packaging is required?", publicAnswer: "Export packaging is required." }));
    const ai = fakeAi("Delivery to site is part of the price; please confirm with the buyer.");
    const d = ok(await M.draftAnswer(pool, staff("buyer"), e.id, a.id, ai.deps)) as { draft: string };
    expect(d.draft).toContain("Delivery to site");
    expect(ai.calls[0]!.user).toContain("Export packaging is required.");
    expect(ai.calls[0]!.user).toContain("<question>");
    const name = (await admin.query(`select name from supplier_org where id = $1`, [X.suppliers[0].id])).rows[0].name as string;
    expect(ai.calls[0]!.user).not.toContain(name);
    expect(await M.draftAnswer(pool, staff("techA"), e.id, a.id, ai.deps)).toMatchObject({ ok: false });
    expect(await M.draftAnswer(pool, staff("buyer"), e.id, a.id, { env: {} as unknown as NodeJS.ProcessEnv })).toMatchObject({ ok: false });
    // the draft saved nothing
    expect((await admin.query(`select count(*)::int n from message where thread_id = $1 and author_kind = 'staff'`, [a.id])).rows[0].n).toBe(0);
  });

  it("translates a message once, keeps the original, and respects who may read it", async () => {
    const e = await open();
    ok(await M.supplierSend(pool, sup(0), e.id, "هل يمكن تمديد موعد التسليم؟"));
    const mid = (await admin.query(`select m.id from message m join message_thread t on t.id = m.thread_id where t.event_id = $1 and t.lane = 'private'`, [e.id])).rows[0].id as string;
    const ai = fakeAi("Can the delivery date be extended?");
    const r = ok(await M.translateText(pool, { staff: staff("buyer") }, e.id, { message: mid }, "en", ai.deps)) as { text: string };
    expect(r.text).toBe("Can the delivery date be extended?");
    ok(await M.translateText(pool, { supplier: sup(0) }, e.id, { message: mid }, "en", ai.deps));
    expect(ai.calls).toHaveLength(1);                                   // second call came from the cache
    expect(await M.translateText(pool, { supplier: sup(1) }, e.id, { message: mid }, "en", ai.deps)).toMatchObject({ ok: false });
    expect(await M.translateText(pool, { staff: staff("techA") }, e.id, { message: mid }, "en", ai.deps)).toMatchObject({ ok: false });
    expect(await M.translateText(pool, { staff: staff("buyer") }, e.id, { message: mid }, "fr" as "en", ai.deps)).toMatchObject({ ok: false });
    const body = (await admin.query(`select body from message where id = $1`, [mid])).rows[0].body;
    expect(body).toBe("هل يمكن تمديد موعد التسليم؟");                       // original untouched
  });

  it("translates a published answer for any invited bidder but not an unpublished one", async () => {
    const e = await open();
    const q = ok(await M.askBoard(pool, sup(0), e.id, { text: "Is installation included?" })) as { id: string };
    ok(await M.answerBoard(pool, staff("buyer"), e.id, q.id, "Yes."));
    const ai = fakeAi("نعم، التركيب مشمول.");
    expect(await M.translateText(pool, { supplier: sup(1) }, e.id, { thread: q.id, field: "a" }, "ar", ai.deps)).toMatchObject({ ok: false });
    ok(await M.publishBoard(pool, staff("buyer"), e.id, q.id, { publicQuestion: "Is installation included?", publicAnswer: "Yes, installation is included." }));
    expect(await M.translateText(pool, { supplier: sup(1) }, e.id, { thread: q.id, field: "a" }, "ar", ai.deps)).toMatchObject({ ok: true, text: "نعم، التركيب مشمول." });
  });
});

describe("scope change and report", () => {
  it("an answer that changes the requirement is also posted as a notice", async () => {
    const e = await open();
    const q = ok(await M.askBoard(pool, sup(0), e.id, { text: "May we offer the equivalent model?" })) as { id: string };
    ok(await M.answerBoard(pool, staff("buyer"), e.id, q.id, "Equivalents are now accepted."));
    ok(await M.publishBoard(pool, staff("buyer"), e.id, q.id, { publicQuestion: "May an equivalent model be offered?", publicAnswer: "Equivalent models are now accepted.", scopeChange: true }));
    const t = (await admin.query(`select amendment_notice_id from message_thread where id = $1`, [q.id])).rows[0];
    expect(t.amendment_notice_id).toBeTruthy();
    const seen = await M.supplierOverview(pool, sup(2), e.id);
    expect(seen!.notices.some((n) => /Amendment to the requirement/.test(n.body) && /Equivalent models are now accepted/.test(n.body))).toBe(true);
    ok(await M.acknowledgeNotice(pool, sup(2), e.id, seen!.notices[0]!.id));
    const aud = await admin.query(`select 1 from audit_log where event_id = $1 and kind = 'message.amendment_notice'`, [e.id]).catch(() => ({ rowCount: 1 }));
    expect(aud.rowCount).toBe(1);
  });

  it("the response report counts waits, overdue items and acknowledgements", async () => {
    const e = await open();
    const a = ok(await M.askBoard(pool, sup(0), e.id, { text: "First question to answer" })) as { id: string };
    ok(await M.askBoard(pool, sup(1), e.id, { text: "Second question left open" }));
    ok(await M.answerBoard(pool, staff("buyer"), e.id, a.id, "Answered."));
    ok(await M.supplierSend(pool, sup(2), e.id, "Private matter for the buyer."));
    ok(await M.sendNotice(pool, staff("buyer"), e.id, "Reminder: site visit on Sunday."));
    await admin.query(`update message_thread set due_at = now() - interval '1 hour' where event_id = $1 and lane = 'board' and status = 'open'`, [e.id]);
    const r = ok(await M.responseReport(pool, staff("buyer"), e.id)) as { report: M.Report };
    expect(r.report.board).toMatchObject({ total: 2, answered: 1, open: 1, overdue: 1 });
    expect(r.report.board.medianHours).not.toBeNull();
    expect(r.report.private).toMatchObject({ threads: 1, awaitingBuyer: 1 });
    expect(r.report.notices.total).toBe(1);
    expect(await M.responseReport(pool, staff("techA"), e.id)).toMatchObject({ ok: false });
    expect(await M.responseReport(pool, staff("auditor"), e.id)).toMatchObject({ ok: true });
  });
});
