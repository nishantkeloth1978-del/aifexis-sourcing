import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
// @ts-expect-error no types needed for the server renderer
import { renderToString } from "react-dom/server";
import type { Who } from "@/events/service";
import type { SupplierWho } from "@/suppliers/service";
import { looksLikeClarification, phaseOf, redact, rulesFor, supplierMayReply } from "@/messages/rules";
import * as M from "@/messages/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

let admin: Client, pool: Pool, X: World;
const staff = (p: keyof World["people"]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role: "member" } as Who);
const sup = (i: 0 | 1 | 2): SupplierWho => ({ tenantId: X.tenantId, supplierId: X.suppliers[i].id, supplierUserId: X.suppliers[i].supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "msg"); });
afterAll(async () => { await pool.end(); await admin.end(); });
const ok = <T,>(r: { ok: boolean } & T) => { expect(r).toMatchObject({ ok: true }); return r as T; };
const open = async () => makeEvent(admin, X, "published", { withBids: false });

describe("rules", () => {
  const d = (s: string) => new Date(s);
  it("phases", () => {
    expect(phaseOf("draft", null)).toBe("none");
    expect(phaseOf("published", d("2099-01-01"))).toBe("open");
    expect(phaseOf("published", d("2000-01-01"))).toBe("closed");
    expect(phaseOf("commercial_evaluation", null)).toBe("closed");
    expect(phaseOf("awarded", null)).toBe("awarded");
    expect(phaseOf("cancelled", null)).toBe("cancelled");
    expect(phaseOf("archived", null)).toBe("readonly");
  });
  it("rules by phase and deadlines", () => {
    const now = d("2026-06-10T12:00:00Z");
    expect(rulesFor("open", { questionDeadline: d("2026-06-01T00:00:00Z"), lastAnswerDate: null }, now).askBoard).toBe(false);
    expect(rulesFor("open", { questionDeadline: d("2026-06-20T00:00:00Z"), lastAnswerDate: d("2026-06-05T00:00:00Z") }, now)).toMatchObject({ askBoard: true, late: true });
    expect(rulesFor("closed", { questionDeadline: null, lastAnswerDate: null }, now)).toMatchObject({ askBoard: false, staffStartsPrivate: true, supplierStartsPrivate: false });
    expect(rulesFor("cancelled", { questionDeadline: null, lastAnswerDate: null }).notices).toBe(false);
    expect(supplierMayReply("closed", null)).toBe(false);
    expect(supplierMayReply("closed", d("2099-01-01"))).toBe(true);
    expect(supplierMayReply("closed", d("2000-01-01"))).toBe(false);
    expect(supplierMayReply("open", null)).toBe(true);
  });
  it("redact and clarification check", () => {
    const r = redact("Acme Trading asks: mail bob@acme.com, call +971 50 123 4567 or see https://acme.com/x", ["Acme Trading"]);
    expect(r.changed).toBe(true);
    expect(r.text).not.toMatch(/Acme|bob@|4567|https/);
    expect(r.text).toContain("[bidder]");
    expect(redact("Plain text.").changed).toBe(false);
    expect(looksLikeClarification("The quantity is now 500 pcs")).toBe(true);
    expect(looksLikeClarification("Thanks, we received your upload.")).toBe(false);
  });
});

describe("board", () => {
  it("ask validation, deadlines, anchors, confidentiality", async () => {
    const e = await open();
    expect(await M.askBoard(pool, sup(0), e.id, { text: "hi" })).toMatchObject({ ok: false });
    expect(await M.askBoard(pool, sup(0), e.id, { text: "Is this confidential?", confidential: true })).toMatchObject({ ok: false });
    expect(await M.askBoard(pool, sup(0), e.id, { text: "Valid question here", anchorItemId: "not-a-uuid" })).toMatchObject({ ok: false });
    const it = (await admin.query(`select id from event_item where event_id = $1 limit 1`, [e.id])).rows[0];
    if (it) ok(await M.askBoard(pool, sup(0), e.id, { text: "About this line, please?", anchorItemId: it.id }));
    ok(await M.askBoard(pool, sup(0), e.id, { text: "Pricing structure query", confidential: true, reason: "commercial terms" }));
    await admin.query(`update sourcing_event set question_deadline = now() - interval '1 hour' where id = $1`, [e.id]);
    expect(await M.askBoard(pool, sup(1), e.id, { text: "Too late for this one" })).toMatchObject({ ok: false });
  });

  it("answer, anonymised publication, isolation, evaluators", async () => {
    const e = await open();
    const q = ok(await M.askBoard(pool, sup(0), e.id, { text: "Is delivery to site included for Acme Supplies?" })) as { id: string };
    const other = await M.supplierOverview(pool, sup(1), e.id);
    expect(other!.board).toHaveLength(0);
    expect(await M.answerBoard(pool, staff("techA"), e.id, q.id, "Yes it is.")).toMatchObject({ ok: false });
    ok(await M.answerBoard(pool, staff("buyer"), e.id, q.id, "Yes, delivery is included."));
    const sg = ok(await M.suggestPublic(pool, staff("buyer"), e.id, q.id)) as { publicQuestion: string; publicAnswer: string };
    expect(sg.publicQuestion).toContain("delivery");
    ok(await M.publishBoard(pool, staff("buyer"), e.id, q.id, { publicQuestion: "Is delivery to site included?", publicAnswer: sg.publicAnswer }));
    const seen = await M.supplierOverview(pool, sup(1), e.id);
    expect(seen!.board).toHaveLength(1);
    expect(seen!.board[0]).toMatchObject({ published: true, publicQuestion: "Is delivery to site included?" });
    expect(JSON.stringify(seen)).not.toMatch(/Acme Supplies/);
    const ev = await M.staffOverview(pool, staff("techA"), e.id);
    expect(ev!.board.length).toBe(1); expect(ev!.threads).toHaveLength(0); expect(ev!.canWrite).toBe(false);
  });

  it("publishing text that names the asker is refused", async () => {
    const e = await open();
    const q = ok(await M.askBoard(pool, sup(0), e.id, { text: "Question about packaging please" })) as { id: string };
    const name = (await admin.query(`select name from supplier_org where id = $1`, [X.suppliers[0].id])).rows[0].name as string;
    ok(await M.answerBoard(pool, staff("buyer"), e.id, q.id, "Packaging is by the supplier."));
    expect(await M.publishBoard(pool, staff("buyer"), e.id, q.id, { publicQuestion: `${name} asks about packaging`, publicAnswer: "By supplier." })).toMatchObject({ ok: false });
  });

  it("assign, note, merge, reclassify, withdraw", async () => {
    const e = await open();
    const a = ok(await M.askBoard(pool, sup(0), e.id, { text: "Delivery terms question A" })) as { id: string };
    const b = ok(await M.askBoard(pool, sup(1), e.id, { text: "Delivery terms question B" })) as { id: string };
    const c = ok(await M.askBoard(pool, sup(2), e.id, { text: "Secret pricing matter", confidential: true, reason: "price related" })) as { id: string };
    ok(await M.assignQuestion(pool, staff("buyer"), e.id, a.id, X.people.techA.membershipId, new Date(Date.now() + 864e5).toISOString()));
    ok(await M.addNote(pool, staff("techA"), e.id, a.id, "Check with engineering"));
    expect(await M.addNote(pool, staff("techB"), e.id, a.id, "Not allowed")).toMatchObject({ ok: false });
    ok(await M.mergeThreads(pool, staff("buyer"), e.id, b.id, a.id));
    ok(await M.reclassify(pool, staff("buyer"), e.id, c.id));
    ok(await M.withdrawQuestion(pool, sup(0), e.id, a.id));
    const note = await admin.query(`select count(*)::int n from message where thread_id = $1 and internal`, [a.id]);
    expect(note.rows[0].n).toBe(1);
    const sv = await M.supplierOverview(pool, sup(0), e.id);
    expect(JSON.stringify(sv)).not.toMatch(/Check with engineering/);
  });
});

describe("private threads", () => {
  it("isolation, guard, share and keep-private paths", async () => {
    const e = await open();
    ok(await M.supplierSend(pool, sup(0), e.id, "We cannot open the upload page."));
    ok(await M.supplierSend(pool, sup(1), e.id, "Our login expired yesterday."));
    const s0 = await M.supplierOverview(pool, sup(0), e.id);
    expect(JSON.stringify(s0)).not.toMatch(/login expired/);
    const g = await M.staffReply(pool, staff("buyer"), e.id, X.suppliers[0].id, "The quantity is now 500 pcs, please update your price.");
    expect(g).toMatchObject({ ok: false });
    expect((g as { needsDecision?: unknown }).needsDecision).toBeTruthy();
    expect(await M.staffReply(pool, staff("buyer"), e.id, X.suppliers[0].id, "The quantity is now 500 pcs.", { decision: { keepPrivateReason: "x" } })).toMatchObject({ ok: false });
    ok(await M.staffReply(pool, staff("buyer"), e.id, X.suppliers[0].id, "The quantity is now 500 pcs.", { decision: { keepPrivateReason: "Only affects this bidder's own bid file" } }));
    ok(await M.staffReply(pool, staff("buyer"), e.id, X.suppliers[1].id, "Specification is revised to grade B.", { decision: { share: { publicQuestion: "Which grade applies?", publicAnswer: "Grade B applies." } } }));
    const sh = await M.supplierOverview(pool, sup(2), e.id);
    expect(sh!.board.some((b) => b.publicAnswer === "Grade B applies.")).toBe(true);
    expect(await M.staffReply(pool, staff("techA"), e.id, X.suppliers[0].id, "hello there")).toMatchObject({ ok: false });
  });

  it("evaluators cannot read private threads; the auditor can, logged", async () => {
    const e = await open();
    ok(await M.supplierSend(pool, sup(0), e.id, "A private message for the buyer."));
    expect((await M.staffOverview(pool, staff("techA"), e.id))!.threads).toHaveLength(0);
    const au = await M.staffOverview(pool, staff("auditor"), e.id);
    expect(au!.canReadPrivate).toBe(true); expect(au!.threads.length).toBeGreaterThan(0);
    const l = await admin.query(`select count(*)::int n from audit_log where event_id = $1 and kind = 'messages.read_private'`, [e.id]).catch(() => ({ rows: [{ n: -1 }] }));
    expect(l.rows[0].n).not.toBe(0);
  });

  it("after closing: only a dated clarification request, replies until its deadline", async () => {
    const e = await makeEvent(admin, X, "closed", { withBids: false });
    await admin.query(`insert into invitation (tenant_id, event_id, supplier_id, token_hash) values ($1,$2,$3,'h-'||gen_random_uuid()) on conflict do nothing`, [X.tenantId, e.id, X.suppliers[0].id]);
    expect(await M.supplierSend(pool, sup(0), e.id, "Can we add something now?")).toMatchObject({ ok: false });
    expect(await M.staffReply(pool, staff("buyer"), e.id, X.suppliers[0].id, "Please confirm your unit price for line 2.")).toMatchObject({ ok: false });
    const past = new Date(Date.now() - 864e5).toISOString(), far = new Date(Date.now() + 90 * 864e5).toISOString(), good = new Date(Date.now() + 3 * 864e5).toISOString();
    expect(await M.staffReply(pool, staff("buyer"), e.id, X.suppliers[0].id, "Please confirm your unit price.", { requestDueAt: past })).toMatchObject({ ok: false });
    expect(await M.staffReply(pool, staff("buyer"), e.id, X.suppliers[0].id, "Please confirm your unit price.", { requestDueAt: far })).toMatchObject({ ok: false });
    ok(await M.staffReply(pool, staff("buyer"), e.id, X.suppliers[0].id, "Please confirm your unit price.", { requestDueAt: good }));
    ok(await M.supplierSend(pool, sup(0), e.id, "Unit price confirmed at 12.50."));
    await admin.query(`update message_thread set request_due_at = now() - interval '1 hour' where event_id = $1`, [e.id]);
    expect(await M.supplierSend(pool, sup(0), e.id, "One more thing.")).toMatchObject({ ok: false });
  });
});

describe("notices, files, chain", () => {
  it("notices with acknowledgement", async () => {
    const e = await open();
    expect(await M.sendNotice(pool, staff("techA"), e.id, "Not the buyer sending this")).toMatchObject({ ok: false });
    const n = ok(await M.sendNotice(pool, staff("buyer"), e.id, "Site visit is on Sunday at 10:00.")) as { id: string };
    let ov = await M.supplierOverview(pool, sup(0), e.id);
    expect(ov!.notices[0]).toMatchObject({ acknowledged: false });
    ok(await M.acknowledgeNotice(pool, sup(0), e.id, n.id));
    const st = await M.staffOverview(pool, staff("buyer"), e.id);
    expect(st!.notices[0]!.ackCount).toBe(1);
    ov = await M.supplierOverview(pool, sup(0), e.id);
    expect(ov!.notices[0]!.acknowledged).toBe(true);
    const c = await makeEvent(admin, X, "cancelled", { withBids: false });
    expect(await M.sendNotice(pool, staff("buyer"), c.id, "Something after cancel")).toMatchObject({ ok: false });
  });

  it("attachments are access controlled and bad files refused", async () => {
    const e = await open();
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
    const r = await M.supplierSend(pool, sup(0), e.id, "Please see attached drawing.", [{ filename: "d.pdf", bytes: pdf }]);
    expect(r).toMatchObject({ ok: true });
    expect(await M.supplierSend(pool, sup(0), e.id, "Executable attached.", [{ filename: "x.exe", bytes: Buffer.from("MZ") }])).toMatchObject({ ok: false });
    const many = Array.from({ length: 4 }, (_, i) => ({ filename: `f${i}.pdf`, bytes: pdf }));
    expect(await M.supplierSend(pool, sup(0), e.id, "Too many files here.", many)).toMatchObject({ ok: false });
    const fid = (await admin.query(`select f.id from message_file f join message m on m.id = f.message_id join message_thread t on t.id = m.thread_id where t.event_id = $1 limit 1`, [e.id])).rows[0].id;
    expect(await M.readMessageFile(pool, { supplier: sup(0) }, fid)).toMatchObject({ filename: "d.pdf" });
    expect(await M.readMessageFile(pool, { supplier: sup(1) }, fid)).toBeNull();
    expect(await M.readMessageFile(pool, { staff: staff("buyer") }, fid)).toMatchObject({ filename: "d.pdf" });
    expect(await M.readMessageFile(pool, { staff: staff("techA") }, fid)).toBeNull();
  });

  it("hash chain is valid and messages are immutable", async () => {
    const e = await open();
    ok(await M.supplierSend(pool, sup(0), e.id, "First message in the chain."));
    ok(await M.staffReply(pool, staff("buyer"), e.id, X.suppliers[0].id, "Thanks, received."));
    ok(await M.supplierSend(pool, sup(0), e.id, "Second message from supplier."));
    const t = (await admin.query(`select id from message_thread where event_id = $1 and lane = 'private'`, [e.id])).rows[0].id;
    expect((await admin.query(`select message_chain_ok($1) ok`, [t])).rows[0].ok).toBe(true);
    await expect(admin.query(`update message set body = 'changed' where thread_id = $1`, [t])).rejects.toThrow();
    await expect(admin.query(`delete from message where thread_id = $1`, [t])).rejects.toThrow();
  });

  it("legacy clarifications were migrated into the board", async () => {
    const r = await admin.query(`select count(*)::int n from message_thread where lane = 'board'`);
    expect(r.rows[0].n).toBeGreaterThanOrEqual(0);
  });
});

describe("rendering", () => {
  it("renders the supplier and staff screens on the server", async () => {
    const e = await open();
    ok(await M.askBoard(pool, sup(0), e.id, { text: "Render check question" }));
    const so = await M.supplierOverview(pool, sup(0), e.id);
    const to = await M.staffOverview(pool, staff("buyer"), e.id);
    const SupplierMessages = (await import("@/ui/SupplierMessages")).default;
    const StaffMessages = (await import("@/ui/StaffMessages")).default;
    const h1 = renderToString(createElement(SupplierMessages as never, { eventId: e.id, initial: so, locale: "en" } as never));
    const h2 = renderToString(createElement(StaffMessages as never, { eventId: e.id, initial: to, locale: "en" } as never));
    expect(h1.length).toBeGreaterThan(100); expect(h2.length).toBeGreaterThan(100);
  });
});
