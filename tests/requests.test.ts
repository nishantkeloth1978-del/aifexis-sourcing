import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { convertToEvent, createRequest, getRequest, listRequests, rejectRequest, validateRequest, withdrawRequest, R_DUPLICATE, R_NO_MANAGE, R_NO_PERM } from "@/requests/service";
import type { Who } from "@/events/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World, Y: World;
const who = (w: World, p: keyof World["people"], role = "member", perms?: string[]): Who => ({ tenantId: w.tenantId, userId: w.people[p].userId, membershipId: w.people[p].membershipId, role, ...(perms ? { perms } : {}) });
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "req-x"); Y = await seedTenant(admin, "req-y"); });
afterAll(async () => { await pool.end(); await admin.end(); });
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { expect(r, JSON.stringify(r)).toMatchObject({ ok: true }); return r as Extract<T, { ok: true }>; };

const REQUESTER = () => who(X, "requester", "member", ["request.create"]);       // can raise, cannot handle
const BUYER = () => who(X, "buyer", "member", ["event.create", "request.create"]);
const input = (patch: object = {}) => ({ kind: "goods", title: "Safety gloves for plant A", description: "", ownerDept: "Operations", lines: [{ description: "Nitrile gloves, size L", quantity: "200", unit: "BOX" }], ...patch });

describe("request validation", () => {
  it("accepts a good request and refuses bad ones", () => {
    expect(validateRequest(input())).toMatchObject({ ok: true });
    for (const bad of [{ kind: "other" }, { title: "ab" }, { title: "x".repeat(201) }, { neededBy: "31-12-2026" }, { estValue: "12.345" }, { estValue: "abc" }, { currency: "dirham" },
      { lines: [{ description: "x", quantity: "0", unit: "EA" }] }, { lines: [] }, { lines: Array.from({ length: 51 }, () => ({ description: "x", quantity: "1", unit: "EA" })) }, { description: "y".repeat(4001) }])
      expect(validateRequest(input(bad)), JSON.stringify(bad).slice(0, 60)).toMatchObject({ ok: false });
    expect(validateRequest(input({ lines: [], description: "A scope in words" }))).toMatchObject({ ok: true });
  });
});

describe("raising and seeing requests", () => {
  it("creates numbered requests, blocks a same-title repeat, and tells buyers", async () => {
    const r = ok(await createRequest(pool, REQUESTER(), input()));
    expect(r.request.ref).toMatch(/^REQ-\d{4}-0001$/); expect(r.request.state).toBe("new");
    expect(await createRequest(pool, REQUESTER(), input({ title: "SAFETY GLOVES for plant A" }))).toEqual({ ok: false, error: R_DUPLICATE });
    expect(ok(await createRequest(pool, REQUESTER(), input({ title: "Cleaning contract, three sites", kind: "service", lines: [] , description: "Monthly cleaning" }))).request.ref).toMatch(/0002$/);
    expect((await admin.query(`select 1 from notification where tenant_id = $1 and kind = 'request_new'`, [X.tenantId])).rowCount).toBeGreaterThan(0);
    expect((await admin.query(`select 1 from audit_event where tenant_id = $1 and action = 'request.created'`, [X.tenantId])).rowCount).toBe(2);
  });
  it("a role with no request or event permission cannot raise one", async () => {
    expect(await createRequest(pool, who(X, "witness", "member", []), input({ title: "No permission here" }))).toEqual({ ok: false, error: R_NO_PERM });
  });
  it("requesters see only their own; buyers see all; other companies see nothing", async () => {
    const other = ok(await createRequest(pool, who(X, "techA", "member", ["request.create"]), input({ title: "Laptops for the design team" })));
    const mine = await listRequests(pool, REQUESTER());
    expect(mine.length).toBe(2); expect(mine.every((m) => m.mine)).toBe(true);
    expect((await listRequests(pool, BUYER())).length).toBe(3);
    expect(await getRequest(pool, REQUESTER(), other.request.id)).toBeNull();
    expect(await getRequest(pool, BUYER(), other.request.id)).toMatchObject({ title: "Laptops for the design team", lines: [{ unit: "BOX" }] });
    expect((await listRequests(pool, who(Y, "buyer", "member", ["event.create", "request.create"]))).length).toBe(0);
    expect(await getRequest(pool, who(Y, "buyer", "member", ["event.create"]), other.request.id)).toBeNull();
    expect((await listRequests(pool, BUYER(), { state: "converted" })).length).toBe(0);
  });
});

describe("handling a request", () => {
  it("withdraw: only the requester, only while new", async () => {
    const r = ok(await createRequest(pool, REQUESTER(), input({ title: "Withdraw me please" }))).request;
    expect(await withdrawRequest(pool, who(X, "techA", "member", ["request.create"]), r.id)).toMatchObject({ ok: false });
    expect(await withdrawRequest(pool, BUYER(), r.id)).toMatchObject({ ok: false });   // a buyer cannot withdraw someone else's
    ok(await withdrawRequest(pool, REQUESTER(), r.id));
    expect((await getRequest(pool, REQUESTER(), r.id))!.state).toBe("withdrawn");
    expect(await withdrawRequest(pool, REQUESTER(), r.id)).toMatchObject({ ok: false });
  });
  it("reject needs a buyer and a reason, and tells the requester", async () => {
    const r = ok(await createRequest(pool, REQUESTER(), input({ title: "Reject me with a reason" }))).request;
    expect(await rejectRequest(pool, REQUESTER(), r.id, "No budget this year")).toEqual({ ok: false, error: R_NO_MANAGE });
    expect(await rejectRequest(pool, BUYER(), r.id, "no")).toMatchObject({ ok: false });
    ok(await rejectRequest(pool, BUYER(), r.id, "No budget this year"));
    expect(await getRequest(pool, REQUESTER(), r.id)).toMatchObject({ state: "rejected", decisionNote: "No budget this year" });
    expect((await admin.query(`select message from notification where tenant_id = $1 and kind = 'request_rejected'`, [X.tenantId])).rows[0].message).toContain("No budget this year");
  });
  it("convert creates one draft event with the lines and the right people, and cannot run twice", async () => {
    const r = ok(await createRequest(pool, REQUESTER(), input({ title: "Convert me to an event", estValue: "12000.50", lines: [{ description: "Item one", quantity: "2", unit: "EA" }, { description: "Item two", quantity: "3.5", unit: "M" }] }))).request;
    expect(await convertToEvent(pool, REQUESTER(), r.id)).toEqual({ ok: false, error: R_NO_MANAGE });
    const c = ok(await convertToEvent(pool, BUYER(), r.id));
    expect(c.eventRef).toMatch(/^EV-\d{4}-\d{3}$/);
    const ev = (await admin.query(`select title, state::text s, value_aed::text v, request_id from sourcing_event where id = $1`, [c.eventId])).rows[0];
    expect(ev).toMatchObject({ title: "Convert me to an event", s: "draft", v: "12000.50", request_id: r.id });
    expect((await admin.query(`select description, quantity::text q, unit, line_no from event_item where event_id = $1 order by line_no`, [c.eventId])).rows).toEqual([{ description: "Item one", q: "2.000", unit: "EA", line_no: 1 }, { description: "Item two", q: "3.500", unit: "M", line_no: 2 }]);
    const roles = (await admin.query(`select event_role, membership_id from event_member where event_id = $1 order by event_role`, [c.eventId])).rows;
    expect(roles).toEqual([{ event_role: "buyer", membership_id: X.people.buyer.membershipId }, { event_role: "requester", membership_id: X.people.requester.membershipId }]);
    expect(await getRequest(pool, REQUESTER(), r.id)).toMatchObject({ state: "converted", eventId: c.eventId, eventRef: c.eventRef });
    expect(await convertToEvent(pool, BUYER(), r.id)).toMatchObject({ ok: false });
    expect((await admin.query(`select 1 from sourcing_event where request_id = $1`, [r.id])).rowCount).toBe(1);
  });
  it("a request in another currency does not set the AED value", async () => {
    const r = ok(await createRequest(pool, REQUESTER(), input({ title: "Euro priced request", estValue: "500", currency: "EUR" }))).request;
    const c = ok(await convertToEvent(pool, BUYER(), r.id));
    expect((await admin.query(`select value_aed, currency from sourcing_event where id = $1`, [c.eventId])).rows[0]).toMatchObject({ value_aed: null, currency: "EUR" });
  });
});
