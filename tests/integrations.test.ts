import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, hashKey, integrationScreen, replayDelivery, revokeClient, I_NO_PERM } from "@/integrations/service";
import { authenticate, getAwardApi, getRequestApi, postRequest } from "@/integrations/api";
import { BACKOFF_SECONDS, checkWebhookUrl, deliverDue, sign } from "@/integrations/webhooks";
import { queueWebhook } from "@/integrations/queue";
import { importRequestsCsv, parseCsv } from "@/requests/import";
import { convertToEvent, rejectRequest, createRequest } from "@/requests/service";
import { decryptKey } from "@/assistant/keys";
import { withTenant } from "@/authz";
import type { Who } from "@/events/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World, Y: World;
const who = (w: World, p: keyof World["people"], role = "member", perms?: string[]): Who => ({ tenantId: w.tenantId, userId: w.people[p].userId, membershipId: w.people[p].membershipId, role, ...(perms ? { perms } : {}) });
beforeAll(async () => { process.env.SIGNING_SECRET = "t".repeat(40); admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "int-x"); Y = await seedTenant(admin, "int-y"); });
afterAll(async () => { await pool.end(); await admin.end(); });
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { expect(r, JSON.stringify(r)).toMatchObject({ ok: true }); return r as Extract<T, { ok: true }>; };
const ADMIN = (w = X) => who(w, "admin", "admin");
const BUYER = () => who(X, "buyer", "member", ["event.create", "request.create"]);
const body = (patch: object = {}) => ({ kind: "goods", title: "Pump spares for line 3", department: "Maintenance", currency: "AED", estimatedValue: "5000", externalReference: "ERP-1", lines: [{ description: "Seal kit", quantity: "10", unit: "EA" }], ...patch });

describe("keys", () => {
  it("only an administrator creates a connection; the key is shown once and stored hashed", async () => {
    expect(await createClient(pool, who(X, "buyer", "member", ["event.create"]), { name: "ERP" })).toEqual({ ok: false, error: I_NO_PERM });
    const r = ok(await createClient(pool, ADMIN(), { name: "ERP middleware", scopes: ["requests:write", "requests:read", "awards:read"], webhookUrl: "https://erp.example.com/hook", events: ["request.accepted", "award.approved"] }));
    expect(r.key).toMatch(/^aifx_[a-f0-9]{12}_[A-Za-z0-9_-]{43}$/);
    const row = (await admin.query(`select * from integration_client where tenant_id = $1 and name = 'ERP middleware'`, [X.tenantId])).rows[0];
    expect(row.key_hash).toBe(hashKey(r.key)); expect(JSON.stringify(row)).not.toContain(r.key); expect(JSON.stringify(row)).not.toContain(r.webhookSecret!);
    expect(decryptKey(row.webhook_secret_enc, X.tenantId, `webhook:${row.id}`)).toBe(r.webhookSecret);
    expect(decryptKey(row.webhook_secret_enc, Y.tenantId, `webhook:${row.id}`)).toBeNull();
  });
  it("refuses unsafe webhook addresses and empty choices", async () => {
    for (const u of ["http://x.example.com/h", "https://localhost/h", "https://10.0.0.5/h", "https://user:pw@x.example.com/h", "https://[::1]/h", "https://db.internal/h", "not a url"]) expect(checkWebhookUrl(u), u).not.toBeNull();
    expect(checkWebhookUrl("https://hooks.example.com/aifexis")).toBeNull();
    expect(await createClient(pool, ADMIN(), { name: "Bad", webhookUrl: "https://localhost/x", events: ["award.approved"] })).toMatchObject({ ok: false });
    expect(await createClient(pool, ADMIN(), { name: "Bad", webhookUrl: "https://hooks.example.com/x", events: [] })).toMatchObject({ ok: false });
    expect(await createClient(pool, ADMIN(), { name: "Bad", scopes: ["nothing"] })).toMatchObject({ ok: false });
  });
  it("authenticates by key, rejects wrong, revoked and malformed keys", async () => {
    const r = ok(await createClient(pool, ADMIN(), { name: "Auth test" }));
    expect(await authenticate(pool, `Bearer ${r.key}`)).toMatchObject({ tenantId: X.tenantId });
    expect(await authenticate(pool, `Bearer ${r.key.slice(0, -1)}${r.key.endsWith("A") ? "B" : "A"}`)).toBeNull();
    expect(await authenticate(pool, "Bearer nonsense")).toBeNull(); expect(await authenticate(pool, null)).toBeNull();
    ok(await revokeClient(pool, ADMIN(), r.client.id));
    expect(await authenticate(pool, `Bearer ${r.key}`)).toBeNull();
  });
});

describe("POST /requests", () => {
  let key = "", client = "";
  beforeAll(async () => { const r = ok(await createClient(pool, ADMIN(), { name: "Intake", scopes: ["requests:write", "requests:read", "awards:read"] })); key = r.key; client = r.client.id; });
  const auth = async () => (await authenticate(pool, `Bearer ${key}`))!;
  it("creates a request from the API with the same rules as the form", async () => {
    const a = await auth();
    const r = await postRequest(pool, a, null, body());
    expect(r.status).toBe(201); expect(r.body.reference).toMatch(/^REQ-\d{4}-\d{4}$/);
    expect((await admin.query(`select source, external_ref from purchase_request where ref = $1 and tenant_id = $2`, [r.body.reference, X.tenantId])).rows[0]).toEqual({ source: "api", external_ref: "ERP-1" });
    expect((await postRequest(pool, a, null, body({ title: "ab", externalReference: "ERP-2" }))).status).toBe(422);
    expect((await postRequest(pool, a, null, [1] as unknown as object)).status).toBe(400);
    expect((await postRequest(pool, a, "x".repeat(101), body({ externalReference: "ERP-3" }))).status).toBe(400);
  });
  it("is idempotent on the header and on the external reference", async () => {
    const a = await auth();
    const first = await postRequest(pool, a, "idem-1", body({ externalReference: "ERP-10", title: "Idempotent order" }));
    const again = await postRequest(pool, a, "idem-1", body({ externalReference: "ERP-10", title: "Idempotent order" }));
    expect(first.status).toBe(201); expect(again.status).toBe(200); expect(again.body).toMatchObject({ reference: first.body.reference, duplicate: true });
    const sameExt = await postRequest(pool, a, "idem-2", body({ externalReference: "ERP-10", title: "Changed title" }));
    expect(sameExt.body).toMatchObject({ reference: first.body.reference, duplicate: true });
    expect((await admin.query(`select count(*)::int n from purchase_request where tenant_id = $1 and external_ref = 'ERP-10'`, [X.tenantId])).rows[0].n).toBe(1);
    const failed = await postRequest(pool, a, "idem-3", body({ title: "x", externalReference: "ERP-11" }));
    expect(failed.status).toBe(422);
    expect((await postRequest(pool, a, "idem-3", body({ externalReference: "ERP-11", title: "Fixed now" }))).status).toBe(201);   // a failed attempt does not burn the key
  });
  it("respects scopes and reads status back", async () => {
    const ro = ok(await createClient(pool, ADMIN(), { name: "Read only", scopes: ["requests:read"] }));
    const roAuth = (await authenticate(pool, `Bearer ${ro.key}`))!;
    expect((await postRequest(pool, roAuth, null, body({ externalReference: "ERP-20" }))).status).toBe(403);
    const a = await auth();
    const made = await postRequest(pool, a, null, body({ externalReference: "ERP-21", title: "Status check" }));
    expect((await getRequestApi(pool, a, made.body.reference as string)).body).toMatchObject({ state: "new", eventReference: null });
    expect((await getRequestApi(pool, a, "ERP-21")).status).toBe(200);
    expect((await getRequestApi(pool, a, "REQ-1999-0001")).status).toBe(404);
    expect((await getAwardApi(pool, roAuth, "EV-1")).status).toBe(403);
  });
  it("never shows another company's data", async () => {
    const other = ok(await createClient(pool, ADMIN(Y), { name: "Other" }));
    const oa = (await authenticate(pool, `Bearer ${other.key}`))!;
    expect((await getRequestApi(pool, oa, "ERP-21")).status).toBe(404);
    expect((await admin.query(`select count(*)::int n from purchase_request where tenant_id = $1`, [Y.tenantId])).rows[0].n).toBe(0);
  });
  it("answers 404 for an award that does not exist and 409 for one not yet awarded", async () => {
    const a = await auth();
    expect((await getAwardApi(pool, a, "EV-0000-000")).status).toBe(404);
    const made = ok(await createRequest(pool, BUYER(), { kind: "goods", title: "Award path event", lines: [{ description: "x", quantity: "1", unit: "EA" }] } as never));
    const ev = ok(await convertToEvent(pool, BUYER(), made.request.id));
    expect((await getAwardApi(pool, a, ev.eventRef)).status).toBe(409);
  });
});

describe("webhooks", () => {
  let secret = "", clientId = "";
  beforeAll(async () => {
    await admin.query(`delete from webhook_delivery where tenant_id = $1`, [X.tenantId]);
    const r = ok(await createClient(pool, ADMIN(), { name: "Hook", webhookUrl: "https://hooks.example.com/aifexis", events: ["request.accepted", "request.rejected", "event.closed"] }));
    secret = r.webhookSecret!; clientId = r.client.id;
  });
  const pending = async () => (await admin.query(`select * from webhook_delivery where tenant_id = $1 and client_id = $2 order by id`, [X.tenantId, clientId])).rows;
  it("queues only the events a client asked for, with request references", async () => {
    const made = ok(await createRequest(pool, BUYER(), { kind: "goods", title: "Hooked request", lines: [{ description: "x", quantity: "1", unit: "EA" }] } as never));
    ok(await convertToEvent(pool, BUYER(), made.request.id));
    const second = ok(await createRequest(pool, who(X, "techA", "member", ["request.create"]), { kind: "service", title: "Hooked and rejected", description: "scope" } as never));
    ok(await rejectRequest(pool, BUYER(), second.request.id, "Not needed now"));
    const rows = await pending();
    expect(rows.map((r) => r.event_type)).toEqual(["request.accepted", "request.rejected"]);
    expect(rows[0].payload.data).toMatchObject({ requestRef: made.request.ref, state: "draft" });
    await withTenant(pool, X.tenantId, (c) => queueWebhook(c, X.tenantId, "award.approved", { eventRef: "EV-X" }));   // not subscribed
    expect((await pending()).length).toBe(2);
  });
  it("signs the body, delivers once, and logs it", async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const r = await deliverDue(pool, X.tenantId, { resolve: async () => ["93.184.216.34"], now: Date.now(), send: async (url, init) => { calls.push({ url, headers: init.headers, body: init.body }); return { status: 204 }; } });
    expect(r.failed).toBe(0); expect(r.delivered).toBeGreaterThanOrEqual(2);
    const c = calls.find((x) => x.headers["x-aifexis-signature"] === sign(secret, x.headers["x-aifexis-timestamp"]!, x.body))!;
    expect(c.headers["x-aifexis-signature"]).toBe(sign(secret, c.headers["x-aifexis-timestamp"]!, c.body));
    expect(c.headers["x-aifexis-event"]).toBe("request.accepted"); expect(c.url).toBe("https://hooks.example.com/aifexis");
    expect((await pending()).every((x) => x.state === "delivered" && x.attempts === 1)).toBe(true);
    expect(await deliverDue(pool, X.tenantId, { resolve: async () => ["93.184.216.34"], send: async () => { throw new Error("must not send"); } })).toEqual({ delivered: 0, failed: 0 });
  });
  it("retries with backoff, then marks dead, and a person can replay it", async () => {
    await withTenant(pool, X.tenantId, (c) => queueWebhook(c, X.tenantId, "event.closed", { eventRef: "EV-9" }));
    const fail = { resolve: async () => ["93.184.216.34"], send: async () => ({ status: 500 }) };
    for (let i = 0; i < BACKOFF_SECONDS.length + 1; i++) {
      await admin.query(`update webhook_delivery set next_attempt_at = now() - interval '1 second' where tenant_id = $1 and state = 'pending'`, [X.tenantId]);
      await deliverDue(pool, X.tenantId, fail);
    }
    const last = (await pending()).pop()!;
    expect(last.state).toBe("dead"); expect(last.attempts).toBe(BACKOFF_SECONDS.length + 1); expect(last.last_error).toContain("500");
    ok(await replayDelivery(pool, ADMIN(), Number(last.id)));
    expect((await pending()).pop()!.state).toBe("pending");
    expect(await replayDelivery(pool, who(X, "buyer", "member", []), Number(last.id))).toEqual({ ok: false, error: I_NO_PERM });
  });
  it("refuses to send to a host that resolves to a private address, and never follows redirects", async () => {
    await withTenant(pool, X.tenantId, (c) => queueWebhook(c, X.tenantId, "event.closed", { eventRef: "EV-10" }));
    await admin.query(`update webhook_delivery set next_attempt_at = now() where tenant_id = $1 and state = 'pending'`, [X.tenantId]);
    let sent = 0;
    const r = await deliverDue(pool, X.tenantId, { resolve: async () => ["10.1.2.3"], send: async () => { sent++; return { status: 200 }; } });
    expect(sent).toBe(0); expect(r.failed).toBeGreaterThan(0);
    await admin.query(`update webhook_delivery set next_attempt_at = now() where tenant_id = $1 and state = 'pending'`, [X.tenantId]);
    let redirect = "";
    await deliverDue(pool, X.tenantId, { resolve: async () => ["93.184.216.34"], send: async (_u, init) => { redirect = init.redirect; return { status: 302 }; } });
    expect(redirect).toBe("manual");
  });
  it("revoking stops pending deliveries and lists them in the screen", async () => {
    ok(await revokeClient(pool, ADMIN(), clientId));
    expect((await pending()).filter((x) => x.state === "pending").length).toBe(0);
    const s = (await integrationScreen(pool, ADMIN()))!;
    expect(s.clients.find((c) => c.id === clientId)).toMatchObject({ active: false });
    expect(await integrationScreen(pool, who(X, "buyer", "member", []))).toBeNull();
  });
});

describe("CSV import", () => {
  it("reads quotes, semicolons and BOM", () => {
    expect(parseCsv('﻿a;b\r\n"x;y";"he said ""hi"""\r\n')).toEqual([["a", "b"], ["x;y", 'he said "hi"']]);
    expect(parseCsv("a,b\n1,2\n\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });
  const REQ = () => who(X, "requester", "member", ["request.create"]);
  it("groups lines, reports row by row, and skips what was already imported", async () => {
    const csv = ["external_ref,kind,title,description,department,needed_by,est_value,currency,line_description,line_quantity,line_unit",
      "F-1,goods,Helmets,,Ops,2027-01-01,1000,AED,Helmet,10,pcs", "F-1,goods,Helmets,,,,,,Strap,10,pcs", "F-2,service,Crane check,Annual,,,,,,,", "F-3,widget,Bad kind,,,,,,,,", ""].join("\r\n");
    const r = await importRequestsCsv(pool, REQ(), csv);
    expect(r).toMatchObject({ ok: true, created: 2, failed: 1, skipped: 0 });
    expect(JSON.parse(JSON.stringify((await admin.query(`select lines from purchase_request where tenant_id = $1 and external_ref = 'F-1'`, [X.tenantId])).rows[0].lines))).toHaveLength(2);
    const again = await importRequestsCsv(pool, REQ(), csv);
    expect(again).toMatchObject({ ok: true, created: 0, skipped: 2, failed: 1 });
  });
  it("rejects a file without the needed columns, an oversize file and too many rows", async () => {
    expect(await importRequestsCsv(pool, REQ(), "a,b\n1,2")).toMatchObject({ ok: false });
    expect(await importRequestsCsv(pool, REQ(), "x".repeat(200_001))).toMatchObject({ ok: false });
    expect(await importRequestsCsv(pool, REQ(), "kind,title\n" + Array.from({ length: 201 }, (_, i) => `goods,Item ${i}`).join("\n"))).toMatchObject({ ok: false });
    expect(await importRequestsCsv(pool, who(X, "witness", "member", []), "kind,title\ngoods,Nope here")).toMatchObject({ ok: true, failed: 1, created: 0 });
  });
});
