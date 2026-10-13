import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client, Pool } from "pg";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";
import type { Who } from "@/events/service";
import { openTechnicalEnvelopes } from "@/evaluation/service";
import { cancelEvent } from "@/events/cancel";
import { decide, inbox, myRequest, requestDecision, withdraw } from "@/decisions/service";

let admin: Client, pool: Pool, X: World, Y: World;
const who = (p: keyof World["people"], w: World = X): Who => ({ tenantId: w.tenantId, userId: w.people[p].userId, membershipId: w.people[p].membershipId, role: "member" } as Who);
const ver = async (id: string) => (await admin.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;
const status = async (id: string) => (await admin.query(`select status from decision_request where id = $1`, [id])).rows[0].status as string;
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "dec-a"); Y = await seedTenant(admin, "dec-b"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("two-person decisions (SEC-02)", () => {
  it("knowing the witness's ID is not enough to open the envelopes", async () => {
    const e = await makeEvent(admin, X, "closed");
    const w = X.people.witness.membershipId;
    expect(await openTechnicalEnvelopes(pool, who("buyer"), e.id, await ver(e.id), w)).toMatchObject({ ok: false });
    const req = await requestDecision(pool, who("buyer"), e.id, await ver(e.id), "OpenEnvelope1", { witnessMembershipId: w });
    expect(req.ok).toBe(true);
    // asked but not yet confirmed: still refused
    expect(await openTechnicalEnvelopes(pool, who("buyer"), e.id, await ver(e.id), w)).toMatchObject({ ok: false });
    expect((await admin.query(`select envelope1_opened_at from sourcing_event where id = $1`, [e.id])).rows[0].envelope1_opened_at).toBeNull();
  });

  it("only the named person can confirm; the requester and others cannot", async () => {
    const e = await makeEvent(admin, X, "closed");
    const w = X.people.witness.membershipId;
    const r = await requestDecision(pool, who("buyer"), e.id, await ver(e.id), "OpenEnvelope1", { witnessMembershipId: w });
    if (!r.ok) throw new Error(r.error);
    expect(await decide(pool, who("buyer"), r.requestId, true)).toMatchObject({ ok: false });
    expect(await decide(pool, who("techA"), r.requestId, true)).toMatchObject({ ok: false });
    expect(await decide(pool, who("witness", Y), r.requestId, true)).toMatchObject({ ok: false });   // another organisation
    expect(await status(r.requestId)).toBe("pending");
    expect((await inbox(pool, who("witness"))).map((x) => x.id)).toContain(r.requestId);
    expect((await inbox(pool, who("buyer"))).map((x) => x.id)).not.toContain(r.requestId);
    expect(await decide(pool, who("witness"), r.requestId, true)).toEqual({ ok: true });
    expect(await status(r.requestId)).toBe("confirmed");
    expect(await openTechnicalEnvelopes(pool, who("buyer"), e.id, await ver(e.id), w)).toEqual({ ok: true });
    expect(await status(r.requestId)).toBe("executed");
    const acts = (await admin.query(`select action from audit_event where event_id = $1 order by at`, [e.id])).rows.map((x) => x.action);
    expect(acts).toEqual(expect.arrayContaining(["decision.requested", "decision.confirmed"]));
  });

  it("a confirmation is used once, and only by the person who asked", async () => {
    const e = await makeEvent(admin, X, "commercial_evaluation");
    const ap = X.people.awardApprover.membershipId;
    const v = await ver(e.id);
    const r = await requestDecision(pool, who("buyer"), e.id, v, "CancelEvent", { approvedByMembershipId: ap, cancelReason: "Scope withdrawn by the business" });
    if (!r.ok) throw new Error(r.error);
    await decide(pool, who("awardApprover"), r.requestId, true);
    // someone else holding the approver's ID cannot use it
    expect(await cancelEvent(pool, who("techA"), e.id, v, { reason: "Scope withdrawn by the business", approverId: ap })).toMatchObject({ ok: false });
    // the wording is part of what was confirmed
    expect(await cancelEvent(pool, who("buyer"), e.id, v, { reason: "A different reason entirely", approverId: ap })).toMatchObject({ ok: false });
    expect(await cancelEvent(pool, who("buyer"), e.id, v, { reason: "Scope withdrawn by the business", approverId: ap })).toEqual({ ok: true });
    expect(await status(r.requestId)).toBe("executed");
  });

  it("a request goes stale when the event changes, expires, or is declined or withdrawn", async () => {
    const ap = X.people.awardApprover.membershipId;
    const mk = async () => {
      const e = await makeEvent(admin, X, "commercial_evaluation");
      const v = await ver(e.id);
      const r = await requestDecision(pool, who("buyer"), e.id, v, "CancelEvent", { approvedByMembershipId: ap, cancelReason: "Scope withdrawn by the business" });
      if (!r.ok) throw new Error(r.error);
      return { e, v, id: r.requestId };
    };
    // the event moves on after the question was asked
    const a = await mk();
    await admin.query(`update sourcing_event set state_version = state_version + 1 where id = $1`, [a.e.id]);
    expect(await decide(pool, who("awardApprover"), a.id, true)).toMatchObject({ ok: false });
    // confirmed, then the event moves on
    const b = await mk();
    await decide(pool, who("awardApprover"), b.id, true);
    await admin.query(`update sourcing_event set state_version = state_version + 1 where id = $1`, [b.e.id]);
    expect(await cancelEvent(pool, who("buyer"), b.e.id, await ver(b.e.id), { reason: "Scope withdrawn by the business", approverId: ap })).toMatchObject({ ok: false });
    // expired
    const c = await mk();
    await admin.query(`update decision_request set expires_at = now() - interval '1 minute' where id = $1`, [c.id]);
    expect(await decide(pool, who("awardApprover"), c.id, true)).toMatchObject({ ok: false });
    expect((await inbox(pool, who("awardApprover"))).map((x) => x.id)).not.toContain(c.id);
    // declined
    const d = await mk();
    expect(await decide(pool, who("awardApprover"), d.id, false)).toEqual({ ok: true });
    expect(await cancelEvent(pool, who("buyer"), d.e.id, d.v, { reason: "Scope withdrawn by the business", approverId: ap })).toMatchObject({ ok: false });
    expect((await myRequest(pool, who("buyer"), d.e.id, "CancelEvent"))?.status).toBe("rejected");
    // withdrawn after confirmation
    const f = await mk();
    await decide(pool, who("awardApprover"), f.id, true);
    expect(await withdraw(pool, who("buyer"), f.id)).toEqual({ ok: true });
    expect(await cancelEvent(pool, who("buyer"), f.e.id, f.v, { reason: "Scope withdrawn by the business", approverId: ap })).toMatchObject({ ok: false });
    expect(await withdraw(pool, who("techA"), f.id)).toMatchObject({ ok: false });
  });

  it("refuses requests nobody could confirm, and a person confirming for themselves", async () => {
    const e = await makeEvent(admin, X, "closed");
    const v = await ver(e.id);
    expect(await requestDecision(pool, who("buyer"), e.id, v, "OpenEnvelope1", { witnessMembershipId: X.people.techA.membershipId })).toMatchObject({ ok: false });   // not a witness
    expect(await requestDecision(pool, who("techA"), e.id, v, "OpenEnvelope1", { witnessMembershipId: X.people.witness.membershipId })).toMatchObject({ ok: false });   // not the buyer
    expect(await requestDecision(pool, who("buyer"), e.id, v + 5, "OpenEnvelope1", { witnessMembershipId: X.people.witness.membershipId })).toMatchObject({ ok: false });  // stale
    expect(await requestDecision(pool, who("buyer"), e.id, v, "CloseEvent", {})).toMatchObject({ ok: false });
    const bad = await admin.query(`insert into decision_request (tenant_id, event_id, command, state_version, payload_hash, requested_by, designated) values ($1,$2,'OpenEnvelope1',$3,'x',$4,$4)`, [X.tenantId, e.id, v, X.people.witness.membershipId]).then(() => "inserted", () => "refused");
    expect(bad).toBe("refused");   // the database also refuses a request answered by its own author
  });

  it("a new request replaces the open one", async () => {
    const e = await makeEvent(admin, X, "closed");
    const v = await ver(e.id);
    const one = await requestDecision(pool, who("buyer"), e.id, v, "OpenEnvelope1", { witnessMembershipId: X.people.witness.membershipId });
    const two = await requestDecision(pool, who("buyer"), e.id, v, "OpenEnvelope1", { witnessMembershipId: X.people.witness.membershipId });
    if (!one.ok || !two.ok) throw new Error("request failed");
    expect(await status(one.requestId)).toBe("cancelled");
    expect(await decide(pool, who("witness"), one.requestId, true)).toMatchObject({ ok: false });
    expect(await decide(pool, who("witness"), two.requestId, true)).toEqual({ ok: true });
  });
});
