import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@/integrations/service";
import { authenticate, postRequest } from "@/integrations/api";
import type { Who } from "@/events/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const ADMIN = (): Who => ({ tenantId: X.tenantId, userId: X.people.admin.userId, membershipId: X.people.admin.membershipId, role: "admin" } as Who);
beforeAll(async () => { process.env.SIGNING_SECRET = "t".repeat(40); admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "auto-ev"); });
afterAll(async () => { await pool.end(); await admin.end(); });
const body = (ext: string) => ({ kind: "goods", title: "Seal kits for pump 3", currency: "AED", externalReference: ext, lines: [{ description: "[SEAL-01] Seal kit", quantity: "10", unit: "Nos" }, { description: "[PUMP-02] Pump", quantity: "2", unit: "Nos" }] });
const key = async (autoEvent: boolean, scopes = ["requests:write", "requests:read"]) => {
  const c = await createClient(pool, ADMIN(), { name: `ERPNext ${autoEvent}${scopes.length}`, scopes, autoEvent });
  if (!c.ok) throw new Error(c.error);
  return { c, a: (await authenticate(pool, `Bearer ${c.key}`))! };
};

describe("auto event", () => {
  it("creates a draft event with the request's lines the moment a request arrives", async () => {
    const { a, c } = await key(true);
    expect(c.client.autoEvent).toBe(true);
    const r = await postRequest(pool, a, "k1", body("MR-1"));
    expect(r.status).toBe(201); expect(r.body).toMatchObject({ state: "converted", eventReference: expect.stringMatching(/^EV-\d{4}-\d{3}$/) });
    const ev = (await admin.query(`select e.id, e.state::text s, e.title, e.created_by from sourcing_event e where e.tenant_id = $1 and e.ref = $2`, [X.tenantId, r.body.eventReference])).rows[0];
    expect(ev).toMatchObject({ s: "draft", title: "Seal kits for pump 3", created_by: X.people.admin.membershipId });
    expect((await admin.query(`select description, quantity::float8 q, unit from event_item where event_id = $1 order by line_no`, [ev.id])).rows).toEqual([{ description: "[SEAL-01] Seal kit", q: 10, unit: "Nos" }, { description: "[PUMP-02] Pump", q: 2, unit: "Nos" }]);
    expect((await admin.query(`select 1 from audit_event where tenant_id = $1 and action = 'integration.event_auto_created' and event_id = $2`, [X.tenantId, ev.id])).rowCount).toBe(1);
    const again = await postRequest(pool, a, "k1b", body("MR-1"));                         // a repeat does not make a second event
    expect(again.status).toBe(200); expect(again.body).toMatchObject({ duplicate: true });
    expect((await admin.query(`select count(*)::int n from sourcing_event where tenant_id = $1 and title = 'Seal kits for pump 3'`, [X.tenantId])).rows[0].n).toBe(1);
  });
  it("leaves the request waiting for a buyer when the connection is not set to auto", async () => {
    const { a, c } = await key(false);
    expect(c.client.autoEvent).toBe(false);
    const r = await postRequest(pool, a, "k2", body("MR-2"));
    expect(r.status).toBe(201); expect(r.body).toMatchObject({ state: "new", eventReference: null });
  });
  it("cannot be switched on for a connection that may not send requests", async () => {
    const c = await createClient(pool, ADMIN(), { name: "Read only", scopes: ["awards:read"], autoEvent: true });
    if (!c.ok) throw new Error(c.error);
    expect(c.client.autoEvent).toBe(false);
  });
});
