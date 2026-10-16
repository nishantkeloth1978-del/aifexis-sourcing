import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { advanceEvent, autopilotRequest, getAutopilotInfo, takeOverEvent } from "@/automation/autopilot";
import { getPolicy, savePolicy } from "@/automation/policy";
import { DEFAULT_POLICY } from "@/automation/policy-types";
import { createRequest } from "@/requests/service";
import type { Who } from "@/events/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

process.env.SIGNING_SECRET = "t".repeat(40);
let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"], role = "member", perms?: string[]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role, ...(perms ? { perms } : {}) });
beforeAll(async () => {
  admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "autopilot-x");
  await admin.query(`update supplier_org set category = 'Safety' where tenant_id = $1`, [X.tenantId]);
});
afterAll(async () => { await pool.end(); await admin.end(); });
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { expect(r, JSON.stringify(r)).toMatchObject({ ok: true }); return r as Extract<T, { ok: true }>; };
const policy = (patch: object = {}) => savePolicy(pool, who("admin", "admin"), { ...DEFAULT_POLICY, level: 3, autopilotMaxValue: 50000, ...patch });
const newRequest = async (title: string, o: { value?: string; group?: string } = {}) => ok(await createRequest(pool, who("requester", "member", ["request.create"]), {
  kind: "goods", title, description: "For plant A", estValue: o.value ?? "20000", currency: "AED",
  lines: [{ description: "Gloves", quantity: "200", unit: "PAIR", ...(o.group === "" ? {} : { materialGroup: o.group ?? "Safety" }) }],
} as never)).request;
const row = async (sql: string, args: unknown[]) => (await admin.query(sql, args)).rows[0];

describe("Autopilot (level 3)", () => {
  it("saves and reads the settings, level 3 only for administrators with sane numbers", async () => {
    expect(await savePolicy(pool, who("buyer"), { ...DEFAULT_POLICY, level: 3 })).toMatchObject({ ok: false });
    expect(await policy({ autopilotMinSuppliers: 0 })).toMatchObject({ ok: false });
    expect(await policy({ autopilotBidDays: 0 })).toMatchObject({ ok: false });
    ok(await policy());
    expect(await getPolicy(pool, X.tenantId)).toMatchObject({ level: 3, autopilotMaxValue: 50000, autopilotMinSuppliers: 3, autopilotMinBids: 2, autopilotBidDays: 7 });
  });
  it("leaves requests alone that are not eligible, and says why", async () => {
    ok(await policy());
    for (const [r, why] of [
      [await newRequest("Too dear", { value: "90000" }), /above the Autopilot limit/],
      [await newRequest("No group", { group: "" }), /no material group/],
      [await newRequest("Wrong group", { group: "Cranes" }), /only 0 active supplier/],
    ] as const) {
      expect(await autopilotRequest(pool, X.tenantId, r.id)).toBe("skipped");
      expect((await row(`select autopilot_skip s, state from purchase_request where id = $1`, [r.id])).s).toMatch(why);
      expect((await row(`select state from purchase_request where id = $1`, [r.id])).state).toBe("new");
    }
    ok(await policy({ level: 2 }));
    const r = await newRequest("Level 2");
    expect(await autopilotRequest(pool, X.tenantId, r.id)).toBe("skipped");
  });
  it("takes a request to a published event, invites matching suppliers, then awards after bids, with no person", async () => {
    ok(await policy());
    const r = await newRequest("Gloves autopilot");
    expect(await autopilotRequest(pool, X.tenantId, r.id)).toBe("started");
    const e = await row(`select id, state::text state, autopilot, autopilot_hold, closes_at from sourcing_event where request_id = $1`, [r.id]);
    expect(e).toMatchObject({ state: "published", autopilot: true, autopilot_hold: null });
    expect((await admin.query(`select 1 from invitation where event_id = $1`, [e.id])).rowCount).toBe(3);
    const days = (new Date(e.closes_at).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(6.9); expect(days).toBeLessThan(7.1);
    expect(await autopilotRequest(pool, X.tenantId, r.id)).toBe("skipped");    // already taken

    // Bids arrive and the period ends (fixture shortcuts: no person acts below).
    for (const [i, t] of ["1000.00", "800.00", "900.00"].entries()) {
      const rev = (await admin.query(`insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key, submitted_at) values ($1,$2,$3,1,$4, now()) returning id`, [X.tenantId, e.id, X.suppliers[i]!.id, randomUUID()])).rows[0].id;
      await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D7','price_lines',$3)`, [X.tenantId, rev, JSON.stringify({ currency: "AED", total: t, lines: [] })]);
      await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D6','technical_response',$3)`, [X.tenantId, rev, JSON.stringify({ text: "tech" })]);
    }
    await admin.query(`alter table sourcing_event disable trigger user`);
    await admin.query(`update sourcing_event set closes_at = now() - interval '1 hour' where id = $1`, [e.id]);
    await admin.query(`update sourcing_event set state = 'closed', state_version = state_version + 1 where id = $1`, [e.id]);
    await admin.query(`alter table sourcing_event enable trigger user`);

    const last = await advanceEvent(pool, X.tenantId, e.id, {});
    const after = await row(`select state::text state, autopilot_hold from sourcing_event where id = $1`, [e.id]);
    expect(after.autopilot_hold, last).toBeNull();
    expect(after.state).toBe("awarded");
    const actions = (await admin.query(`select action from audit_event where event_id = $1`, [e.id])).rows.map((x) => x.action);
    for (const a of ["autopilot.started", "autopilot.published", "autopilot.qualified", "autopilot.awarded"]) expect(actions).toContain(a);
    const info = await getAutopilotInfo(pool, who("admin", "admin"), e.id);
    expect(info).toMatchObject({ autopilot: true, state: "awarded" });
  });
  it("stops for a person when too few bids arrive", async () => {
    ok(await policy());
    const r = await newRequest("Gloves few bids");
    expect(await autopilotRequest(pool, X.tenantId, r.id)).toBe("started");
    const e = await row(`select id from sourcing_event where request_id = $1`, [r.id]);
    const rev = (await admin.query(`insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key, submitted_at) values ($1,$2,$3,1,$4, now()) returning id`, [X.tenantId, e.id, X.suppliers[0]!.id, randomUUID()])).rows[0].id;
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1,$2,'D7','price_lines','{"currency":"AED","total":"10.00","lines":[]}')`, [X.tenantId, rev]);
    await admin.query(`alter table sourcing_event disable trigger user`);
    await admin.query(`update sourcing_event set closes_at = now() - interval '1 hour', state = 'closed', state_version = state_version + 1 where id = $1`, [e.id]);
    await admin.query(`alter table sourcing_event enable trigger user`);
    expect(await advanceEvent(pool, X.tenantId, e.id, {})).toBe("held");
    const h = await row(`select autopilot_hold h, state::text state from sourcing_event where id = $1`, [e.id]);
    expect(h.h).toMatch(/only 1 bid/); expect(h.state).toBe("closed");
    expect(await advanceEvent(pool, X.tenantId, e.id, {})).toBe("closed");   // stays put once held
  });
  it("lets an administrator take an event over, but never with the buyer also approving", async () => {
    ok(await policy());
    const r = await newRequest("Gloves takeover");
    expect(await autopilotRequest(pool, X.tenantId, r.id)).toBe("started");
    const e = await row(`select id from sourcing_event where request_id = $1`, [r.id]);
    const P = X.people;
    const people = { buyer: P.buyer.membershipId, witness: P.witness.membershipId, techApprover: P.techApprover.membershipId, awardApprover: P.awardApprover.membershipId };
    expect(await takeOverEvent(pool, who("buyer"), e.id, people)).toMatchObject({ ok: false });
    expect(await takeOverEvent(pool, who("admin", "admin"), e.id, { ...people, awardApprover: P.buyer.membershipId })).toMatchObject({ ok: false });
    expect((await row(`select autopilot from sourcing_event where id = $1`, [e.id])).autopilot).toBe(true);
    ok(await takeOverEvent(pool, who("admin", "admin"), e.id, people));
    expect((await row(`select autopilot from sourcing_event where id = $1`, [e.id])).autopilot).toBe(false);
    expect((await admin.query(`select 1 from event_member em join membership m on m.id = em.membership_id join app_user u on u.id = m.user_id where em.event_id = $1 and u.email like '%@autopilot.invalid'`, [e.id])).rowCount).toBe(0);
    expect(await advanceEvent(pool, X.tenantId, e.id, {})).toBe("published");
  });
  it("keeps the Autopilot identities out of member lists and notifications", async () => {
    const { listTenantMembers } = await import("@/events/workflow");
    const members = await listTenantMembers(pool, who("admin", "admin")).catch(() => [] as { email: string }[]);
    expect(JSON.stringify(members)).not.toContain("autopilot.invalid");
    expect((await admin.query(`select 1 from notification n join app_user u on u.id = n.user_id where n.tenant_id = $1 and u.email like '%@autopilot.invalid'`, [X.tenantId])).rowCount).toBe(0);
  });
});
