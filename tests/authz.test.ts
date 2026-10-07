import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client, Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_RULES, STATE_ORDER, applyTransition, checkTransition, decideRead, exportEvent, readBidItems, readCalculationRuns,
  readClarifications, readTechResults, readTechScores, renderDigest, resolvePermitted, retrieveContext, searchDerived,
  signedUrl, submitBid, verifySignedUrl, withTenant,
  type Actor, type DataClass, type EventState, type RuleSet,
} from "@/authz";
import { SECRET, adminClient, makeEvent, makePool, seedTenant, type EventIds, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World, Y: World;
const events = {} as Record<EventState, EventIds>;

const internal = (w: World, who: keyof World["people"]): Actor => ({ kind: "internal", userId: w.people[who].userId, tenantId: w.tenantId });
const supplier = (w: World, i: 0 | 1 | 2): Actor => ({ kind: "supplier", supplierUserId: w.suppliers[i].supplierUserId, tenantId: w.tenantId });
const as = <T>(actor: Actor, fn: (c: import("pg").PoolClient) => Promise<T>) => withTenant(pool, actor.tenantId, fn);
const noCommercial = (v: unknown) => {
  const s = JSON.stringify(v);
  expect(s).not.toContain(SECRET);
  expect(s).not.toMatch(/"D7"|"D9"|price_total/);
};

beforeAll(async () => {
  admin = await adminClient();
  pool = makePool(8);
  X = await seedTenant(admin, "X");
  Y = await seedTenant(admin, "Y");
  for (const s of STATE_ORDER) events[s] = await makeEvent(admin, X, s);
});
afterAll(async () => { await pool.end(); await admin.end(); });

describe("A1 buyer cannot read the technical envelope before opening", () => {
  it("is sealed in draft, published and closed states on every path", async () => {
    const buyer = internal(X, "buyer");
    for (const s of ["draft", "published", "closed"] as const) {
      const id = events[s].id;
      expect(await as(buyer, (c) => decideRead(c, buyer, id, "D6"))).toMatchObject({ allow: false, reason: "ENVELOPE_SEALED" });
      expect(await as(buyer, (c) => readBidItems(c, buyer, id))).toEqual([]);
      expect(await as(buyer, (c) => searchDerived(c, buyer, id, "Technical"))).toEqual([]);
      const exp = await as(buyer, (c) => exportEvent(c, buyer, id));
      expect(exp!.bidItems).toEqual([]);
      expect(exp!.derived).toEqual([]);
    }
  });
  it("opens D6 after envelope 1 and D7 only after envelope 2", async () => {
    const buyer = internal(X, "buyer");
    const t = await as(buyer, (c) => readBidItems(c, buyer, events.technical_evaluation.id));
    expect(t.every((i) => i.dataClass === "D6")).toBe(true);
    expect(t.length).toBe(3);
    const c2 = await as(buyer, (c) => readBidItems(c, buyer, events.commercial_evaluation.id));
    expect(new Set(c2.filter((i) => i.dataClass === "D7").map((i) => i.supplierId)).size).toBe(2); // qualified bidders only
  });
});

describe("A2 technical evaluator never reads commercial data, in any state, on any path", () => {
  it.each(STATE_ORDER)("state %s", async (state) => {
    const tech = internal(X, "techA");
    const id = events[state].id;
    for (const cls of ["D7", "D9", "D13", "D14"] as DataClass[]) {
      expect((await as(tech, (c) => decideRead(c, tech, id, cls))).allow).toBe(false);
    }
    const items = await as(tech, (c) => readBidItems(c, tech, id));
    expect(items.every((i) => i.dataClass === "D6")).toBe(true);
    noCommercial(items);
    noCommercial(await as(tech, (c) => searchDerived(c, tech, id, SECRET)));
    noCommercial(await as(tech, (c) => searchDerived(c, tech, id, "price")));
    noCommercial(await as(tech, (c) => exportEvent(c, tech, id)));
    noCommercial(await as(tech, (c) => retrieveContext(c, tech, id, "price total AED commercial")));
    noCommercial(await as(tech, (c) => readCalculationRuns(c, tech, id)));
    expect(await as(tech, (c) => renderDigest(c, tech, id))).not.toMatch(/total \d/);
  });
});

describe("A3 searching for commercial terms leaks nothing, not even counts", () => {
  it("'price', 'AED' and the secret return the same as a nonsense query", async () => {
    const tech = internal(X, "techA");
    const id = events.commercial_evaluation.id;
    const nonsense = await as(tech, (c) => searchDerived(c, tech, id, "zzzzqqqq"));
    for (const q of ["price", "AED", "total", SECRET, "100000"]) {
      expect(await as(tech, (c) => searchDerived(c, tech, id, q))).toEqual(nonsense);
    }
    const technical = await as(tech, (c) => searchDerived(c, tech, id, "datasheet"));
    expect(technical.length).toBe(3); // technical search still works
  });
});

describe("A4 AI retrieval filters before retrieval", () => {
  const stubModel = (context: string[]) => ({ context, answer: `answered from ${context.length} chunks` });
  it("a technical evaluator's commercial question retrieves no commercial chunk", async () => {
    const tech = internal(X, "techA");
    const chunks = await as(tech, (c) => retrieveContext(c, tech, events.commercial_evaluation.id, "give me a commercial summary: price total AED"));
    const model = stubModel(chunks.map((x) => x.content));
    expect(model.context.join(" ")).not.toContain(SECRET);
    expect(chunks.every((x) => x.dataClass === "D8")).toBe(true);
  });
  it("the commercial evaluator's same question does retrieve commercial chunks (for qualified bidders only)", async () => {
    const comm = internal(X, "comm");
    const chunks = await as(comm, (c) => retrieveContext(c, comm, events.commercial_evaluation.id, "price total AED"));
    expect(chunks.length).toBe(2);
    expect(chunks.every((x) => x.dataClass === "D9")).toBe(true);
  });
  it("a job acting for a technical evaluator cannot be granted more than the evaluator may see", async () => {
    const job: Actor = { kind: "job", jobId: "j1", tenantId: X.tenantId, onBehalfOfUserId: X.people.techA.userId, grants: ["D6", "D8", "D7", "D9"] };
    const chunks = await as(job, (c) => retrieveContext(c, job, events.commercial_evaluation.id, "price total AED"));
    noCommercial(chunks);
  });
});

describe("A5 commercial evaluator and technical scores", () => {
  it("never reads individual scores; reads the final technical result only after technical approval", async () => {
    const comm = internal(X, "comm");
    for (const s of ["technical_evaluation", "technical_approved", "commercial_evaluation", "awarded"] as const) {
      expect(await as(comm, (c) => readTechScores(c, comm, events[s].id))).toEqual([]);
    }
    expect(await as(comm, (c) => readTechResults(c, comm, events.technical_evaluation.id))).toEqual([]);
    expect((await as(comm, (c) => readTechResults(c, comm, events.technical_approved.id))).length).toBe(3);
  });
  it("a technical evaluator sees only their own scores until the result is approved", async () => {
    const t = internal(X, "techA");
    const during = await as(t, (c) => readTechScores(c, t, events.technical_evaluation.id));
    expect(during.length).toBe(3);
    expect(during.every((r) => r.evaluator_membership_id === X.people.techA.membershipId)).toBe(true);
    const after = await as(t, (c) => readTechScores(c, t, events.technical_approved.id));
    expect(after.length).toBe(6);
  });
});

describe("A6 only qualified bidders' commercial envelopes are opened", () => {
  it("the commercial evaluator sees suppliers 1 and 2, never supplier 3", async () => {
    const comm = internal(X, "comm");
    const items = await as(comm, (c) => readBidItems(c, comm, events.commercial_evaluation.id));
    const ids = new Set(items.filter((i) => i.dataClass === "D7").map((i) => i.supplierId));
    expect(ids).toEqual(new Set([X.suppliers[0].id, X.suppliers[1].id]));
    const doc = events.commercial_evaluation.objects.d7[2]!; // supplier 3's commercial document
    expect(await as(comm, (c) => signedUrl(c, comm, doc))).toMatchObject({ allow: false, reason: "NOT_FOUND" });
    const own = events.commercial_evaluation.objects.d7[0]!;
    expect((await as(comm, (c) => signedUrl(c, comm, own))).allow).toBe(true);
  });
});

describe("A7 a supplier sees only its own data", () => {
  it("bids, documents and private clarification threads", async () => {
    const s1 = supplier(X, 0);
    const id = events.commercial_evaluation.id;
    const items = await as(s1, (c) => readBidItems(c, s1, id));
    expect(new Set(items.map((i) => i.supplierId))).toEqual(new Set([X.suppliers[0].id]));
    expect(items.map((i) => i.dataClass).sort()).toEqual(["D6", "D7"]); // its own, both envelopes
    expect(await as(s1, (c) => searchDerived(c, s1, id, "supplier"))).toEqual([]);
    const th = await as(s1, (c) => readClarifications(c, s1, id));
    expect(th.map((t) => t.body).sort()).toEqual(["Private question from supplier 1", "Shared answer for everyone"]);
    expect(await as(s1, (c) => signedUrl(c, s1, events.commercial_evaluation.objects.d7[1]!))).toMatchObject({ allow: false, reason: "NOT_FOUND" });
    expect((await as(s1, (c) => signedUrl(c, s1, events.commercial_evaluation.objects.d7[0]!))).allow).toBe(true);
    expect(await as(s1, (c) => exportEvent(c, s1, id))).toMatchObject({ derived: [] });
  });
});

describe("A8 suppliers cannot cross events or buyers", () => {
  it("a supplier of tenant X cannot reach an event of tenant Y", async () => {
    const yEvent = (await makeEvent(admin, Y, "published")).id;
    const s = supplier(X, 0);
    expect(await as(s, (c) => decideRead(c, s, yEvent, "D2"))).toEqual({ allow: false, reason: "NOT_FOUND" });
    expect(await as(s, (c) => readBidItems(c, s, yEvent))).toEqual([]);
  });
  it("a supplier without an invitation cannot see the event", async () => {
    const ev = await makeEvent(admin, X, "published", { invite: [0] });
    const s3 = supplier(X, 2);
    expect(await as(s3, (c) => decideRead(c, s3, ev.id, "D2"))).toEqual({ allow: false, reason: "NOT_FOUND" });
    const s1 = supplier(X, 0);
    expect((await as(s1, (c) => decideRead(c, s1, ev.id, "D2"))).allow).toBe(true);
  });
  it("a supplier cannot read a draft event even when invited", async () => {
    const s1 = supplier(X, 0);
    expect((await as(s1, (c) => decideRead(c, s1, events.draft.id, "D2"))).allow).toBe(false);
  });
});

describe("A9 another tenant learns nothing, including whether the thing exists", () => {
  it("every path answers exactly as it does for an id that does not exist", async () => {
    const y = internal(Y, "buyer");
    const target = events.commercial_evaluation;
    const ghost = randomUUID();
    const real = await as(y, (c) => decideRead(c, y, target.id, "D7"));
    const none = await as(y, (c) => decideRead(c, y, ghost, "D7"));
    expect(real).toEqual(none);
    expect(real).toEqual({ allow: false, reason: "NOT_FOUND" });
    expect(await as(y, (c) => readBidItems(c, y, target.id))).toEqual([]);
    expect(await as(y, (c) => searchDerived(c, y, target.id, "supplier"))).toEqual([]);
    expect(await as(y, (c) => exportEvent(c, y, target.id))).toBeNull();
    expect(await as(y, (c) => signedUrl(c, y, target.objects.d7[0]!))).toEqual(await as(y, (c) => signedUrl(c, y, randomUUID())));
    const job: Actor = { kind: "job", jobId: "j", tenantId: Y.tenantId, onBehalfOfUserId: Y.people.buyer.userId, grants: ["D6", "D7", "D8", "D9"] };
    expect(await as(job, (c) => retrieveContext(c, job, target.id, "supplier"))).toEqual([]);
    expect(await as(y, (c) => checkTransition(c, y, target.id, "CloseEvent"))).toEqual({ allow: false, reason: "NOT_FOUND" });
  });
  it("an actor claiming tenant X while connected as tenant Y gets nothing", async () => {
    const claimsX = internal(X, "buyer");
    const out = await withTenant(pool, Y.tenantId, (c) => resolvePermitted(c, claimsX, events.closed.id));
    expect(out).toEqual({ ok: false, reason: "NOT_FOUND" });
  });
});

describe("A10, A11, A19 separation of duties", () => {
  it("A10: the buyer cannot approve their own event's award", async () => {
    const b = internal(X, "buyer");
    const r = await as(b, (c) => applyTransition(c, b, events.pending_award.id, "ApproveAward", { expectedVersion: 0, payload: { idempotencyKey: randomUUID() } }));
    expect(r).toMatchObject({ ok: false, decision: { allow: false, reason: "FORBIDDEN_ROLE" } });
  });
  it("A11: an evaluator cannot approve the technical result", async () => {
    const t = internal(X, "techA");
    const r = await as(t, (c) => checkTransition(c, t, events.technical_evaluation.id, "ApproveTechnicalResult", 0));
    expect(r).toEqual({ allow: false, reason: "FORBIDDEN_ROLE" });
  });
  it("A19: a delegate who is an evaluator is blocked; a clean delegate may act", async () => {
    const ev = await makeEvent(admin, X, "pending_award");
    await admin.query(`insert into delegation (tenant_id, event_id, from_membership_id, to_membership_id) values ($1, $2, $3, $4)`,
      [X.tenantId, ev.id, X.people.awardApprover.membershipId, X.people.techA.membershipId]);
    const evaluator = internal(X, "techA");
    expect(await as(evaluator, (c) => checkTransition(c, evaluator, ev.id, "ApproveAward"))).toEqual({ allow: false, reason: "SOD_VIOLATION" });
    await admin.query(`insert into delegation (tenant_id, event_id, from_membership_id, to_membership_id) values ($1, $2, $3, $4)`,
      [X.tenantId, ev.id, X.people.awardApprover.membershipId, X.people.delegate.membershipId]);
    const clean = internal(X, "delegate");
    expect((await as(clean, (c) => checkTransition(c, clean, ev.id, "ApproveAward"))).allow).toBe(true);
  });
});

const OP_ID = "00000000-0000-4000-8000-0000000000a1";

describe("A12 and A13 concurrency and idempotency", () => {
  it("A12: two simultaneous award approvals with the same key give one decision and one audit record", async () => {
    const ev = await makeEvent(admin, X, "pending_award");
    const a = internal(X, "awardApprover");
    const key = randomUUID();
    const go = () => as(a, (c) => applyTransition(c, a, ev.id, "ApproveAward", { expectedVersion: 0, payload: { idempotencyKey: key } }));
    const [r1, r2] = await Promise.all([go(), go()]);
    expect(r1.ok && r2.ok).toBe(true);
    expect([r1, r2].filter((r) => r.ok && r.duplicate).length).toBe(1);
    expect((await admin.query(`select count(*)::int n from approval where event_id = $1 and step = 'award'`, [ev.id])).rows[0].n).toBe(1);
    expect((await admin.query(`select count(*)::int n from audit_event where event_id = $1 and action = 'award.approved'`, [ev.id])).rows[0].n).toBe(1);
    expect((await admin.query(`select state from sourcing_event where id = $1`, [ev.id])).rows[0].state).toBe("awarded");
    const again = await go(); // a later retry is still a duplicate, not an error
    expect(again).toMatchObject({ ok: true, duplicate: true });
  });
  it("A12b: a stale version is rejected", async () => {
    const ev = await makeEvent(admin, X, "recommended");
    const b = internal(X, "buyer");
    const r = await as(b, (c) => applyTransition(c, b, ev.id, "SubmitForAward", { expectedVersion: 5 }));
    expect(r).toMatchObject({ ok: false, decision: { reason: "STALE_VERSION" } });
  });
  it("A13: a retried bid submission returns the same revision; a new key makes revision 2", async () => {
    const ev = await makeEvent(admin, X, "published", { withBids: false });
    const s = supplier(X, 0);
    const key = randomUUID();
    const items = [{ dataClass: "D6" as const, kind: "technical_answer", payload: { text: "t" } }, { dataClass: "D7" as const, kind: "price_total", payload: { total: 1, marker: SECRET } }];
    const go = () => as(s, (c) => submitBid(c, s, ev.id, { items, idempotencyKey: key }));
    const [a, b] = await Promise.all([go(), go()]);
    expect(a).toMatchObject({ ok: true }); expect(b).toMatchObject({ ok: true });
    if (a.ok && b.ok) { expect(a.revisionId).toBe(b.revisionId); expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]); }
    const second = await as(s, (c) => submitBid(c, s, ev.id, { items, idempotencyKey: randomUUID() }));
    expect(second).toMatchObject({ ok: true, revisionNo: 2, duplicate: false });
    expect((await admin.query(`select count(*)::int n from bid_revision where event_id = $1`, [ev.id])).rows[0].n).toBe(2);
    // only the latest revision is what evaluators later read
    const latest = await admin.query(`select max(revision_no) m from bid_revision where event_id = $1`, [ev.id]);
    expect(latest.rows[0].m).toBe(2);
  });
  it("A13b: bids are refused after the deadline and outside the published state", async () => {
    const closed = await makeEvent(admin, X, "published", { withBids: false, closesAt: new Date(Date.now() - 1000).toISOString() });
    const s = supplier(X, 0);
    expect(await as(s, (c) => submitBid(c, s, closed.id, { items: [], idempotencyKey: randomUUID() }))).toMatchObject({ ok: false, decision: { reason: "DEADLINE_PASSED" } });
    expect(await as(s, (c) => submitBid(c, s, events.closed.id, { items: [], idempotencyKey: randomUUID() }))).toMatchObject({ ok: false, decision: { reason: "BAD_STATE" } });
  });
});

describe("A14 platform operator access needs a tenant-approved, time-boxed, audited grant", () => {
  it("no grant, expired grant and a valid grant", async () => {
    const id = events.commercial_evaluation.id;
    const op = (grant?: string): Actor => ({ kind: "operator", operatorId: OP_ID, tenantId: X.tenantId, ...(grant ? { breakGlassGrantId: grant } : {}) });
    expect(await as(op(), (c) => readBidItems(c, op(), id))).toEqual([]);
    const mkGrant = async (expires: string) => (await admin.query(
      `insert into break_glass_grant (tenant_id, operator_id, event_id, approved_by, expires_at) values ($1, '00000000-0000-4000-8000-0000000000a1', $2, $3, $4) returning id`,
      [X.tenantId, id, X.people.admin.userId, expires])).rows[0].id as string;
    const expired = await mkGrant(new Date(Date.now() - 60000).toISOString());
    expect(await as(op(expired), (c) => readBidItems(c, op(expired), id))).toEqual([]);
    const valid = await mkGrant(new Date(Date.now() + 60000).toISOString());
    const items = await as(op(valid), (c) => readBidItems(c, op(valid), id));
    expect(items.length).toBeGreaterThan(0);
    expect((await admin.query(`select count(*)::int n from audit_event where action = 'break_glass.access' and event_id = $1`, [id])).rows[0].n).toBeGreaterThan(0);
    const other = events.closed.id; // a grant for one event does not open another
    expect(await as(op(valid), (c) => readBidItems(c, op(valid), other))).toEqual([]);
  });
});

describe("A15 and A16 exports and notifications", () => {
  it("A15: an evaluator's export contains only permitted classes and is audited", async () => {
    const t = internal(X, "techB");
    const id = events.commercial_evaluation.id;
    const exp = await as(t, (c) => exportEvent(c, t, id));
    noCommercial(exp);
    expect(exp!.classes).not.toContain("D7");
    const log = await admin.query(`select detail from audit_event where event_id = $1 and action = 'export' and actor like $2 order by id desc limit 1`, [id, `%${X.people.techB.userId}%`]);
    expect(log.rows[0].detail.classes).toEqual(exp!.classes);
  });
  it("A16: a digest carries commercial figures only for recipients who may read them", async () => {
    const id = events.commercial_evaluation.id;
    const comm = internal(X, "comm"), tech = internal(X, "techA"), req = internal(X, "requester");
    expect(await as(comm, (c) => renderDigest(c, comm, id))).toMatch(/total 10\d{4}/);
    expect(await as(tech, (c) => renderDigest(c, tech, id))).not.toMatch(/total \d/);
    expect(await as(req, (c) => renderDigest(c, req, id))).not.toMatch(/total \d/);
  });
});

describe("A17 access ends as soon as the role is removed", () => {
  it("the next request is denied; nothing is cached", async () => {
    const ev = await makeEvent(admin, X, "commercial_evaluation");
    const comm = internal(X, "comm");
    expect((await as(comm, (c) => readBidItems(c, comm, ev.id))).length).toBeGreaterThan(0);
    await admin.query(`delete from event_member where event_id = $1 and membership_id = $2`, [ev.id, X.people.comm.membershipId]);
    expect(await as(comm, (c) => readBidItems(c, comm, ev.id))).toEqual([]);
  });
});

describe("A18 reopening for amendment re-seals envelopes and keeps history", () => {
  it("evaluators lose access; opening records stay; the qualified list is superseded; the version moves on", async () => {
    const ev = await makeEvent(admin, X, "commercial_evaluation");
    const buyer = internal(X, "buyer"), tech = internal(X, "techA");
    expect((await as(tech, (c) => readBidItems(c, tech, ev.id))).length).toBeGreaterThan(0);
    const noPm = await as(buyer, (c) => applyTransition(c, buyer, ev.id, "ReopenForAmendment", { expectedVersion: 0 }));
    expect(noPm).toMatchObject({ ok: false, decision: { reason: "APPROVAL_REQUIRED" } });
    const r = await as(buyer, (c) => applyTransition(c, buyer, ev.id, "ReopenForAmendment", { expectedVersion: 0, payload: { approvedByMembershipId: X.people.awardApprover.membershipId } }));
    expect(r).toMatchObject({ ok: true });
    expect(await as(tech, (c) => readBidItems(c, tech, ev.id))).toEqual([]);
    const comm = internal(X, "comm");
    expect(await as(comm, (c) => readBidItems(c, comm, ev.id))).toEqual([]);
    expect((await admin.query(`select count(*)::int n from opening_record where event_id = $1`, [ev.id])).rows[0].n).toBe(2);
    expect((await admin.query(`select count(*)::int n from qualified_bidder where event_id = $1 and superseded_at is not null`, [ev.id])).rows[0].n).toBe(2);
    const row = (await admin.query(`select state, current_version from sourcing_event where id = $1`, [ev.id])).rows[0];
    expect(row).toEqual({ state: "published", current_version: 2 });
  });
});

describe("A20 publishing a new configuration does not change a running event", () => {
  it("the event keeps the configuration snapshot taken at publication", async () => {
    const ev = await makeEvent(admin, X, "pending_publication");
    const approver = internal(X, "pubApprover");
    const r = await as(approver, (c) => applyTransition(c, approver, ev.id, "ApprovePublication", { expectedVersion: 0 }));
    expect(r).toMatchObject({ ok: true });
    await admin.query(`insert into tenant_config (tenant_id, version, model) values ($1, 2, '{"model":"equipment_tco","version":2}')`, [X.tenantId]);
    const snap = (await admin.query(`select config_snapshot from sourcing_event where id = $1`, [ev.id])).rows[0].config_snapshot;
    expect(snap.version).toBe(1);
    await admin.query(`delete from tenant_config where tenant_id = $1 and version = 2`, [X.tenantId]).catch(() => undefined);
  });
});

describe("full lifecycle through the transition commands", () => {
  it("draft to awarded, with witnesses, qualified bidders and the right visibility at each step", async () => {
    const ev = await makeEvent(admin, X, "draft", { withBids: false, closesAt: new Date(Date.now() + 3600_000).toISOString() });
    const buyer = internal(X, "buyer"), pub = internal(X, "pubApprover"), tech = internal(X, "techA"), comm = internal(X, "comm");
    const techAppr = internal(X, "techApprover"), award = internal(X, "awardApprover");
    const run = (a: Actor, cmd: string, v: number, payload = {}) => as(a, (c) => applyTransition(c, a, ev.id, cmd, { expectedVersion: v, payload }));

    expect(await run(buyer, "SubmitForPublication", 0)).toMatchObject({ ok: true });
    expect(await run(buyer, "ApprovePublication", 1)).toMatchObject({ ok: false, decision: { reason: "FORBIDDEN_ROLE" } });
    expect(await run(pub, "ApprovePublication", 1)).toMatchObject({ ok: true });

    for (const i of [0, 1, 2] as const) {
      const s = supplier(X, i);
      const items = [{ dataClass: "D6" as const, kind: "technical_answer", payload: { text: `tech ${i}` } }, { dataClass: "D7" as const, kind: "price_total", payload: { total: 1000 + i, marker: SECRET } }];
      expect(await as(s, (c) => submitBid(c, s, ev.id, { items, idempotencyKey: randomUUID() }))).toMatchObject({ ok: true });
    }
    // deadline reached: the system closes the event; before that it cannot
    const sys: Actor = { kind: "system", tenantId: X.tenantId };
    expect(await run(sys, "CloseEvent", 2)).toMatchObject({ ok: false, decision: { reason: "DEADLINE_NOT_REACHED" } });
    await admin.query(`update sourcing_event set closes_at = now() - interval '1 minute' where id = $1`, [ev.id]);
    expect(await run(sys, "CloseEvent", 2)).toMatchObject({ ok: true });

    expect(await run(buyer, "OpenEnvelope1", 3)).toMatchObject({ ok: false, decision: { reason: "WITNESS_REQUIRED" } });
    expect(await run(buyer, "OpenEnvelope1", 3, { witnessMembershipId: X.people.techA.membershipId })).toMatchObject({ ok: false, decision: { reason: "WITNESS_REQUIRED" } }); // an evaluator is not a witness
    expect(await run(buyer, "OpenEnvelope1", 3, { witnessMembershipId: X.people.witness.membershipId })).toMatchObject({ ok: true });
    expect((await as(tech, (c) => readBidItems(c, tech, ev.id))).length).toBe(3);
    expect(await as(comm, (c) => readBidItems(c, comm, ev.id))).toEqual([]);

    expect(await run(techAppr, "ApproveTechnicalResult", 4, { qualifiedSupplierIds: [randomUUID()] })).toMatchObject({ ok: false, decision: { reason: "INVALID_QUALIFIED_LIST" } });
    expect(await run(techAppr, "ApproveTechnicalResult", 4, { qualifiedSupplierIds: [X.suppliers[0].id, X.suppliers[1].id] })).toMatchObject({ ok: true });
    expect(await as(comm, (c) => readBidItems(c, comm, ev.id))).toEqual([]); // approved, but envelope 2 not opened yet

    expect(await run(buyer, "OpenEnvelope2", 5, { witnessMembershipId: X.people.witness.membershipId })).toMatchObject({ ok: true });
    const seen = await as(comm, (c) => readBidItems(c, comm, ev.id));
    expect(new Set(seen.filter((i) => i.dataClass === "D7").map((i) => i.supplierId))).toEqual(new Set([X.suppliers[0].id, X.suppliers[1].id]));
    const rec = (await admin.query(`select qualified_supplier_ids from opening_record where event_id = $1 and envelope = 2`, [ev.id])).rows[0];
    expect(new Set(rec.qualified_supplier_ids)).toEqual(new Set([X.suppliers[0].id, X.suppliers[1].id]));

    expect(await run(buyer, "RecordRecommendation", 6)).toMatchObject({ ok: true });
    expect(await run(buyer, "SubmitForAward", 7)).toMatchObject({ ok: true });
    expect(await run(award, "ApproveAward", 8, { idempotencyKey: randomUUID() })).toMatchObject({ ok: true });
    expect((await admin.query(`select state from sourcing_event where id = $1`, [ev.id])).rows[0].state).toBe("awarded");
    expect(await run(buyer, "CloseEvent", 9)).toMatchObject({ ok: false, decision: { reason: "BAD_STATE" } });
    const audited = await admin.query(`select count(*)::int n from audit_event where event_id = $1 and action like 'transition:%'`, [ev.id]);
    expect(audited.rows[0].n).toBeGreaterThanOrEqual(8);
  });
});

describe("signed URLs", () => {
  it("are short-lived and verifiable", async () => {
    const buyer = internal(X, "buyer");
    const doc = events.technical_evaluation.objects.d6[0]!;
    const r = await as(buyer, (c) => signedUrl(c, buyer, doc, 60));
    expect(r.allow).toBe(true);
    expect(verifySignedUrl(r.url!)).toMatchObject({ ok: true, objectId: doc });
    expect(verifySignedUrl(r.url!, Date.now() + 120_000).ok).toBe(false); // expired
    expect(verifySignedUrl(r.url!.replace(/sig=.{4}/, "sig=0000")).ok).toBe(false); // tampered
  });
});

// ------------------------------------------------------------------ mutation checks: the suite must be able to fail

type Violation = string;
/** Invariant checks written against the rules table only. Used on the real rules (no violations) and on broken copies (must find some). */
async function sealedChecks(rules: RuleSet): Promise<Violation[]> {
  const v: Violation[] = [];
  const classesFor = async (who: keyof World["people"], state: EventState) => {
    const actor = internal(X, who);
    const r = await as(actor, (c) => resolvePermitted(c, actor, events[state].id, rules));
    return r.ok ? r.permitted : {};
  };
  for (const s of STATE_ORDER) {
    const tech = await classesFor("techA", s);
    if (tech.D7 || tech.D9) v.push(`technical evaluator can read commercial data in ${s}`);
  }
  for (const s of ["draft", "published", "closed"] as const) {
    const buyer = await classesFor("buyer", s);
    if (buyer.D6 || buyer.D7) v.push(`buyer can read sealed envelopes in ${s}`);
  }
  const comm = await classesFor("comm", "commercial_evaluation");
  if (comm.D7 && comm.D7.kind !== "qualified") v.push("commercial evaluator is not limited to qualified bidders");
  return v;
}

describe("mutation checks", () => {
  const clone = (): RuleSet => structuredClone(DEFAULT_RULES);
  it("the real rules satisfy every sealed-envelope invariant", async () => {
    expect(await sealedChecks(DEFAULT_RULES)).toEqual([]);
  });
  it("a rule that lets technical evaluators read D7 is caught", async () => {
    const m = clone();
    m.eventRoles.tech_evaluator.push({ cls: "D7", scope: "all", from: "technical_evaluation" });
    expect((await sealedChecks(m)).some((x) => x.startsWith("technical evaluator"))).toBe(true);
  });
  it("a rule that lets the buyer read D6 before opening is caught", async () => {
    const m = clone();
    m.eventRoles.buyer = m.eventRoles.buyer.map((r) => (r.cls === "D6" ? { cls: "D6", scope: "all" as const } : r));
    expect((await sealedChecks(m)).some((x) => x.startsWith("buyer can read sealed"))).toBe(true);
  });
  it("widening the commercial evaluator from qualified to all is caught", async () => {
    const m = clone();
    m.eventRoles.comm_evaluator = m.eventRoles.comm_evaluator.map((r) => (r.cls === "D7" ? { ...r, scope: "all" as const } : r));
    expect((await sealedChecks(m)).some((x) => x.includes("qualified"))).toBe(true);
  });
  it("a broken rule also changes what the data layer returns (tests would fail on the data, not only on the table)", async () => {
    const m = clone();
    m.eventRoles.tech_evaluator.push({ cls: "D7", scope: "all", from: "technical_evaluation" });
    const tech = internal(X, "techA");
    const items = await as(tech, (c) => readBidItems(c, tech, events.commercial_evaluation.id, m));
    expect(JSON.stringify(items)).toContain(SECRET); // proves the leak assertions in A2 would have failed
  });
});
