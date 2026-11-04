import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addToPlan, freshLinks, inviteOnPublish, listPlan, removeFromPlan } from "@/suppliers/plan";
import { listInvitations, participationOf, respondToInvitation, type SupplierWho } from "@/suppliers/service";
import { decideApplication, getRegistration, listApplications, setRegistration, submitApplication, vendorRegInfo } from "@/suppliers/registration";
import { approvePublication, submitForPublication } from "@/events/workflow";
import { getBidForm } from "@/bids/service";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

process.env.SIGNING_SECRET = "t".repeat(40);
process.env.APP_URL = "https://sourcing.example.test";
let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"], role = "member", perms?: string[]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role, ...(perms ? { perms } : {}) });
const sup = (i: number): SupplierWho => ({ tenantId: X.tenantId, supplierId: X.suppliers[i]!.id, supplierUserId: X.suppliers[i]!.supplierUserId, supplierName: `Supplier ${i + 1}`, tenantName: "T", email: "s@x.test" });
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { expect(r, JSON.stringify(r)).toMatchObject({ ok: true }); return r as Extract<T, { ok: true }>; };
const ADMIN = () => who("admin", "admin");
const BUYER = () => who("buyer");
const NOBODY = () => who("requester", "member", ["request.create"]);
beforeAll(async () => {
  admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "vendor-portal-x");
  await admin.query(`update supplier_org set category = 'AV and systems' where tenant_id = $1 and name in ('Supplier 1','Supplier 2')`, [X.tenantId]);
  await admin.query(`update supplier_org set contact_email = 'supplier1@test.local' where tenant_id = $1 and name = 'Supplier 1'`, [X.tenantId]);
});
afterAll(async () => { await pool.end(); await admin.end(); });
const draft = async () => { const e = await makeEvent(admin, X, "draft", { withBids: false, invite: [] }); await admin.query(`delete from event_member where event_id = $1 and event_role in ('publication_approver')`, [e.id]); return e.id; };

describe("suppliers chosen on a draft are invited when it is published", () => {
  it("only the buyer or an administrator picks, only on a draft, by name or by category", async () => {
    const id = await draft();
    expect(await addToPlan(pool, NOBODY(), id, { supplierIds: [X.suppliers[0]!.id] })).toMatchObject({ ok: false });
    expect(await addToPlan(pool, BUYER(), id, {})).toMatchObject({ ok: false });
    expect(ok(await addToPlan(pool, BUYER(), id, { supplierIds: [X.suppliers[2]!.id] })).added).toBe(1);
    expect(ok(await addToPlan(pool, BUYER(), id, { category: "av and SYSTEMS" })).added).toBe(2);
    expect((await listPlan(pool, BUYER(), id)).map((p) => p.name)).toEqual(["Supplier 1", "Supplier 2", "Supplier 3"]);
    ok(await removeFromPlan(pool, BUYER(), id, X.suppliers[2]!.id));
    expect(await listPlan(pool, BUYER(), id)).toHaveLength(2);
  });
  it("creates the invitations and queues e-mails at publication, and clears the plan", async () => {
    const id = await draft();
    ok(await addToPlan(pool, BUYER(), id, { category: "AV and systems" }));
    const n = await admin.query(`select count(*)::int n from email_outbox where tenant_id = $1`, [X.tenantId]);
    const count = await new Promise<number>((resolve, reject) => {
      pool.connect().then(async (c) => {
        try { await c.query("begin"); await c.query(`select set_config('app.tenant_id', $1, true)`, [X.tenantId]); await c.query(`set local role app_runtime`); const k = await inviteOnPublish(c, X.tenantId, id, X.people.buyer.membershipId); await c.query("commit"); resolve(k); }
        catch (e) { await c.query("rollback").catch(() => undefined); reject(e); } finally { c.release(); }
      }, reject);
    });
    expect(count).toBe(2);
    expect((await admin.query(`select count(*)::int n from invitation where event_id = $1`, [id])).rows[0].n).toBe(2);
    expect((await admin.query(`select count(*)::int n from event_supplier_plan where event_id = $1`, [id])).rows[0].n).toBe(0);
    const mails = (await admin.query(`select to_email, body from email_outbox where tenant_id = $1 and event_id = $2`, [X.tenantId, id])).rows;
    expect(mails.length).toBeGreaterThanOrEqual(1);
    expect(mails[0].body).toContain("https://sourcing.example.test/invite/");
    expect(n.rows[0].n).toBeLessThan((await admin.query(`select count(*)::int n from email_outbox where tenant_id = $1`, [X.tenantId])).rows[0].n);
  });
  it("hands out fresh links for a published event", async () => {
    const e = await makeEvent(admin, X, "published", { withBids: false, invite: [0, 1] });
    const r = ok(await freshLinks(pool, BUYER(), e.id));
    expect(r.links).toHaveLength(2);
    expect(r.links[0]!.url).toMatch(/^https:\/\/sourcing\.example\.test\/invite\/[A-Za-z0-9_-]{40,}$/);
    expect(await freshLinks(pool, NOBODY(), e.id)).toMatchObject({ ok: false });
    expect((await listInvitations(pool, BUYER(), e.id))[0]).toMatchObject({ response: null });
  });
  it("publishing through the normal approval path invites the planned suppliers by itself", async () => {
    const { addItem } = await import("@/events/service");
    const e = await makeEvent(admin, X, "draft", { withBids: false, invite: [] });
    await admin.query(`update sourcing_event set closes_at = now() + interval '5 days' where id = $1`, [e.id]);
    ok(await addItem(pool, who("requester"), e.id, { description: "Camera", quantity: "2", unit: "EA" }));
    ok(await addToPlan(pool, BUYER(), e.id, { category: "AV and systems" }));
    const ver = async () => (await admin.query(`select state_version from sourcing_event where id = $1`, [e.id])).rows[0].state_version as number;
    ok(await submitForPublication(pool, BUYER(), e.id, await ver()));
    expect((await admin.query(`select count(*)::int n from invitation where event_id = $1`, [e.id])).rows[0].n).toBe(0);   // not before approval
    ok(await approvePublication(pool, who("pubApprover"), e.id, await ver()));
    expect((await admin.query(`select state::text s from sourcing_event where id = $1`, [e.id])).rows[0].s).toBe("published");
    expect((await admin.query(`select count(*)::int n from invitation where event_id = $1`, [e.id])).rows[0].n).toBe(2);
    expect(await listPlan(pool, BUYER(), e.id)).toHaveLength(0);
  });
});

describe("a supplier confirms or declines", () => {
  it("accepts, declines with a reason, cannot decline after bidding, and a decline stops bidding", async () => {
    const e = await makeEvent(admin, X, "published", { withBids: false, invite: [0, 1] });
    expect(await participationOf(pool, sup(0), e.id)).toBeNull();
    expect(await respondToInvitation(pool, sup(0), e.id, "maybe")).toMatchObject({ ok: false });
    expect(await respondToInvitation(pool, sup(0), e.id, "declined", "no")).toMatchObject({ ok: false });
    ok(await respondToInvitation(pool, sup(0), e.id, "accepted"));
    expect(await participationOf(pool, sup(0), e.id)).toBe("accepted");
    ok(await respondToInvitation(pool, sup(1), e.id, "declined", "Cannot meet the schedule"));
    const inv = await listInvitations(pool, BUYER(), e.id);
    expect(inv.find((i) => i.supplierId === X.suppliers[1]!.id)).toMatchObject({ response: "declined", declineReason: "Cannot meet the schedule" });
    const form = await getBidForm(pool, sup(1), e.id);
    expect(form).toMatchObject({ open: false, participation: "declined", closedReason: "You declined this invitation." });
    expect(await getBidForm(pool, sup(0), e.id)).toMatchObject({ open: true, participation: "accepted" });
    ok(await respondToInvitation(pool, sup(1), e.id, "accepted"));       // can change mind while open
    expect(await getBidForm(pool, sup(1), e.id)).toMatchObject({ open: true });
    expect(await respondToInvitation(pool, sup(2), e.id, "accepted")).toMatchObject({ ok: false });   // not invited
    expect((await admin.query(`select 1 from audit_event where event_id = $1 and action in ('supplier.accepted','supplier.declined')`, [e.id])).rowCount).toBe(3);
  });
});

describe("vendor registration", () => {
  it("is off until an administrator switches it on; the public form creates a pending application", async () => {
    expect(await getRegistration(pool, NOBODY())).toBeNull();
    expect(await setRegistration(pool, NOBODY(), true)).toMatchObject({ ok: false });
    const reg = ok(await setRegistration(pool, who("buyer", "member", ["supplier.manage"]), true)).registration;
    expect(reg.url).toBe(`https://sourcing.example.test/vendors/register/${reg.key}`);
    expect(await vendorRegInfo(pool, "nonsense")).toBeNull();
    expect(await vendorRegInfo(pool, reg.key)).toMatchObject({ tenantName: "vendor-portal-x" });
    const input = { company: "Gulf Cameras LLC", contactName: "Sam", contactEmail: "SAM@gulfcameras.test", country: "UAE", category: "AV and systems", phone: "+971 1", taxNo: "TRN1", notes: "" };
    expect(await submitApplication(pool, "bad", input)).toMatchObject({ ok: false });
    expect(await submitApplication(pool, reg.key, { ...input, contactEmail: "nope" })).toMatchObject({ ok: false });
    ok(await submitApplication(pool, reg.key, input));
    expect(await submitApplication(pool, reg.key, input)).toMatchObject({ ok: false, error: expect.stringMatching(/already waiting/) });
    const staffEmail = (await admin.query(`select email from app_user where id = $1`, [X.people.buyer.userId])).rows[0].email;
    expect(await submitApplication(pool, reg.key, { ...input, company: "Another Co", contactEmail: staffEmail })).toMatchObject({ ok: false });
    const apps = await listApplications(pool, ADMIN());
    expect(apps).toHaveLength(1); expect(apps[0]).toMatchObject({ state: "pending", contactEmail: "sam@gulfcameras.test" });
    expect(await listApplications(pool, NOBODY())).toEqual([]);
  });
  it("approval creates the supplier with its profile; rejection needs a reason; both e-mail the applicant", async () => {
    const reg = (await getRegistration(pool, ADMIN()))!;
    const [a] = await listApplications(pool, ADMIN());
    expect(await decideApplication(pool, NOBODY(), a!.id, true)).toMatchObject({ ok: false });
    ok(await decideApplication(pool, ADMIN(), a!.id, true));
    expect(await decideApplication(pool, ADMIN(), a!.id, true)).toMatchObject({ ok: false });
    const s = (await admin.query(`select s.category, s.country, s.contact_email, (select count(*)::int from supplier_user su where su.supplier_id = s.id) as users from supplier_org s where s.tenant_id = $1 and s.name = 'Gulf Cameras LLC'`, [X.tenantId])).rows[0];
    expect(s).toMatchObject({ category: "AV and systems", country: "UAE", contact_email: "sam@gulfcameras.test", users: 1 });
    expect((await admin.query(`select 1 from email_outbox where tenant_id = $1 and to_email = 'sam@gulfcameras.test' and subject like '%approved%'`, [X.tenantId])).rowCount).toBe(1);
    expect(await submitApplication(pool, reg.key, { company: "Gulf Cameras LLC", contactName: "Sam", contactEmail: "other@x.test", country: "", category: "", phone: "", taxNo: "", notes: "" })).toMatchObject({ ok: false, error: expect.stringMatching(/already registered/) });
    ok(await submitApplication(pool, reg.key, { company: "Dubious Ltd", contactName: "Dee", contactEmail: "dee@dubious.test", country: "", category: "", phone: "", taxNo: "", notes: "" }));
    const pending = (await listApplications(pool, ADMIN())).find((x) => x.state === "pending")!;
    expect(await decideApplication(pool, ADMIN(), pending.id, false, "")).toMatchObject({ ok: false });
    ok(await decideApplication(pool, ADMIN(), pending.id, false, "Not in our scope"));
    expect((await listApplications(pool, ADMIN())).find((x) => x.id === pending.id)).toMatchObject({ state: "rejected", decisionNote: "Not in our scope" });
    ok(await setRegistration(pool, ADMIN(), false));
    expect(await vendorRegInfo(pool, reg.key)).toBeNull();
    expect(await submitApplication(pool, reg.key, { company: "Late Co", contactName: "Lee", contactEmail: "lee@late.test", country: "", category: "", phone: "", taxNo: "", notes: "" })).toMatchObject({ ok: false });
  });
});
