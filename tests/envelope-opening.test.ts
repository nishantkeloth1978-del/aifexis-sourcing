import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/authz";
import { cleanOpening, modeFor, validateOpening } from "@/authz/opening";
import { saveConfig, resolveConfig, DEFAULT_CONFIG } from "@/config/service";
import { closeBidding, getEvalView, openTechnicalEnvelopes } from "@/evaluation/service";
import { openCommercialEnvelopes } from "@/commercial/service";
import { autoOpenIfConfigured, openAllEnvelopes } from "@/opening/service";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

process.env.SIGNING_SECRET = "t".repeat(40);
let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"], role = "member"): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role });
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "opening-x"); });
afterAll(async () => { await pool.end(); await admin.end(); });

let ver = 1;
/** Save the company's evaluation settings as a new version (superuser, so the test controls them exactly). */
async function setOpening(opening: unknown, extra: object = {}) {
  ver += 1;
  await admin.query(`insert into tenant_config (tenant_id, version, model) values ($1, $2, $3)`, [X.tenantId, ver, JSON.stringify({ evaluation: { ...DEFAULT_CONFIG, ...extra, ...(opening ? { opening } : {}) } })]);
}
const ev = async (state: "closed" | "published" | "technical_approved", o: { value?: number | null; bids?: boolean } = {}) => {
  const e = await makeEvent(admin, X, state, { withBids: o.bids !== false });
  if (o.value !== undefined) await admin.query(`update sourcing_event set value_aed = $2 where id = $1`, [e.id, o.value]);
  return e.id;
};
const row = async (id: string) => (await admin.query(`select state::text state, state_version v, envelope1_opened_at e1, envelope2_opened_at e2 from sourcing_event where id = $1`, [id])).rows[0];
const records = async (id: string) => (await admin.query(`select envelope, opened_by, witness, opened_mode from opening_record where event_id = $1 and opened_mode is not null order by envelope`, [id])).rows;
const err = (r: { ok: boolean }) => (r as { error?: string }).error;

describe("opening policy as data", () => {
  it("falls back to the strict default, and picks the mode by event value", () => {
    expect(cleanOpening(undefined)).toBeUndefined();
    expect(cleanOpening({ mode: "witnessed", envelopes: "two" })).toBeUndefined();
    expect(cleanOpening({ mode: "nonsense" })).toBeUndefined();
    const p = cleanOpening({ mode: "buyer", envelopes: "two", tiers: [{ minValue: 100000, mode: "witnessed" }, { minValue: 10000, mode: "automatic" }] })!;
    expect(modeFor(p, 5000)).toBe("buyer");
    expect(modeFor(p, 10000)).toBe("automatic");
    expect(modeFor(p, 99999)).toBe("automatic");
    expect(modeFor(p, 100000)).toBe("witnessed");
    expect(modeFor(p, null)).toBe("witnessed");         // unknown value: the strictest rule
    expect(validateOpening({ mode: "buyer", envelopes: "two", tiers: [{ minValue: 5, mode: "buyer" }, { minValue: 5, mode: "witnessed" }] })).toMatch(/different/);
    expect(validateOpening({ mode: "buyer", envelopes: "single", tiers: [{ minValue: -1, mode: "buyer" }] })).toMatch(/whole amount/);
  });
  it("is saved with the company settings and rejected when it makes no sense", async () => {
    const base = { ...DEFAULT_CONFIG };
    expect(await saveConfig(pool, who("buyer"), { ...base, opening: { mode: "buyer", envelopes: "two" } })).toMatchObject({ ok: false });
    expect(await saveConfig(pool, who("admin", "admin"), { ...base, opening: { mode: "buyer", envelopes: "two", tiers: [{ minValue: 9, mode: "buyer" }, { minValue: 9, mode: "witnessed" }] } })).toMatchObject({ ok: false });
    expect(await saveConfig(pool, who("admin", "admin"), { ...base, opening: { mode: "buyer", envelopes: "single", tiers: [{ minValue: 250000, mode: "witnessed" }] } })).toMatchObject({ ok: true });
    ver = (await admin.query(`select max(version)::int v from tenant_config where tenant_id = $1`, [X.tenantId])).rows[0].v;
    const cfg = await withTenant(pool, X.tenantId, (c) => resolveConfig(c));
    expect(cfg.opening).toEqual({ mode: "buyer", envelopes: "single", tiers: [{ minValue: 250000, mode: "witnessed" }] });
  });
});

describe("witnessed (the default)", () => {
  it("still needs a witness who confirms", async () => {
    await setOpening(null);
    const id = await ev("closed"), v = (await row(id)).v;
    expect(err(await openTechnicalEnvelopes(pool, who("buyer"), id, v))).toMatch(/witness/i);
    expect(err(await openTechnicalEnvelopes(pool, who("buyer"), id, v, X.people.witness.membershipId))).toMatch(/not confirmed/i);
    expect((await row(id)).state).toBe("closed");
  });
});

describe("buyer alone", () => {
  it("lets the buyer open without a witness, records it, and keeps others out", async () => {
    await setOpening({ mode: "buyer", envelopes: "two" });
    const id = await ev("closed"), v = (await row(id)).v;
    expect(err(await openTechnicalEnvelopes(pool, who("techA"), id, v))).toMatch(/required role/i);
    expect((await openTechnicalEnvelopes(pool, who("buyer"), id, v))).toMatchObject({ ok: true });
    expect(await row(id)).toMatchObject({ state: "technical_evaluation" });
    expect(await records(id)).toEqual([{ envelope: 1, opened_by: X.people.buyer.membershipId, witness: null, opened_mode: "buyer" }]);
    const a = (await admin.query(`select action, detail from audit_event where event_id = $1 and action = 'transition:OpenEnvelope1'`, [id])).rows[0];
    expect(a.detail).toMatchObject({ opening_mode: "buyer", witnessed: false });
  });
  it("opens the commercial envelopes alone too", async () => {
    await setOpening({ mode: "buyer", envelopes: "two" });
    const id = await ev("technical_approved"), v = (await row(id)).v;
    expect(await openCommercialEnvelopes(pool, who("buyer"), id, v)).toMatchObject({ ok: true });
    expect((await row(id)).state).toBe("commercial_evaluation");
    expect((await records(id))[0]).toMatchObject({ envelope: 2, witness: null, opened_mode: "buyer" });
  });
  it("shows the screen which way this event opens", async () => {
    await setOpening({ mode: "buyer", envelopes: "single" });
    const id = await ev("closed");
    expect((await getEvalView(pool, who("buyer"), id))?.opening).toEqual({ mode: "buyer", envelopes: "single" });
  });
});

describe("automatic", () => {
  it("opens the technical envelopes by itself when bidding is closed", async () => {
    await setOpening({ mode: "automatic", envelopes: "two" });
    const id = await ev("published"), v = (await row(id)).v;
    expect(await closeBidding(pool, who("buyer"), id, v)).toMatchObject({ ok: true });
    expect((await row(id)).state).toBe("technical_evaluation");
    expect(await records(id)).toEqual([{ envelope: 1, opened_by: null, witness: null, opened_mode: "automatic" }]);
    expect((await admin.query(`select 1 from audit_event where event_id = $1 and action = 'opening.automatic'`, [id])).rowCount).toBe(1);
  });
  it("leaves the event closed when there are no bids, for a person to handle", async () => {
    await setOpening({ mode: "automatic", envelopes: "two" });
    const id = await ev("published", { bids: false }), v = (await row(id)).v;
    expect(await closeBidding(pool, who("buyer"), id, v)).toMatchObject({ ok: true });
    expect((await row(id)).state).toBe("closed");
    expect(await records(id)).toEqual([]);
  });
  it("opens the commercial envelopes by itself once the technical result is approved", async () => {
    await setOpening({ mode: "automatic", envelopes: "two" });
    const id = await ev("technical_approved");
    expect(await withTenant(pool, X.tenantId, (c) => autoOpenIfConfigured(c, X.tenantId, id))).toBe(true);
    expect((await row(id)).state).toBe("commercial_evaluation");
    expect((await records(id))[0]).toMatchObject({ envelope: 2, opened_by: null, opened_mode: "automatic" });
  });
  it("never opens by itself when the mode is not automatic", async () => {
    await setOpening({ mode: "buyer", envelopes: "two" });
    const id = await ev("closed");
    expect(await withTenant(pool, X.tenantId, (c) => autoOpenIfConfigured(c, X.tenantId, id))).toBe(false);
    expect((await row(id)).state).toBe("closed");
  });
});

describe("one envelope", () => {
  it("opens everything together, qualifies every bidder and goes straight to price comparison", async () => {
    await setOpening({ mode: "buyer", envelopes: "single" });
    const id = await ev("closed"), v = (await row(id)).v;
    expect(err(await openTechnicalEnvelopes(pool, who("buyer"), id, v))).toMatch(/different way/i);
    expect(await openAllEnvelopes(pool, who("buyer"), id, v)).toMatchObject({ ok: true });
    expect(await row(id)).toMatchObject({ state: "commercial_evaluation" });
    expect((await row(id)).e1).not.toBeNull(); expect((await row(id)).e2).not.toBeNull();
    expect((await admin.query(`select 1 from qualified_bidder where event_id = $1`, [id])).rowCount).toBe(3);
    expect((await admin.query(`select total::float8 t, qualified from tech_result where event_id = $1`, [id])).rows).toEqual(Array(3).fill({ t: 100, qualified: true }));
    expect((await records(id)).map((r) => r.envelope)).toEqual([1, 2]);
  });
  it("refuses the one-step opening when the company uses two envelopes", async () => {
    await setOpening({ mode: "buyer", envelopes: "two" });
    const id = await ev("closed"), v = (await row(id)).v;
    expect(err(await openAllEnvelopes(pool, who("buyer"), id, v))).toMatch(/different way/i);
  });
  it("leaves out bidders who failed a disqualifying declaration, and stops when nobody is left", async () => {
    await setOpening({ mode: "buyer", envelopes: "single" }, { gates: ["Valid trade licence"], knockout: ["Valid trade licence"] });
    const id = await ev("closed"), v = (await row(id)).v;
    expect(err(await openAllEnvelopes(pool, who("buyer"), id, v))).toMatch(/failed a mandatory declaration/i);
    expect((await row(id)).state).toBe("closed");
    const rev = await admin.query(`insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key, submitted_at) values ($1, $2, $3, 2, $4, now()) returning id`, [X.tenantId, id, X.suppliers[0].id, `rev2-${id}`]);
    await admin.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1, $2, 'D6', 'technical_answer', $3)`, [X.tenantId, rev.rows[0].id, JSON.stringify({ text: "Revised", gates: [{ name: "Valid trade licence", answer: true }] })]);
    expect(await openAllEnvelopes(pool, who("buyer"), id, v)).toMatchObject({ ok: true });
    expect((await admin.query(`select supplier_id from qualified_bidder where event_id = $1`, [id])).rows).toEqual([{ supplier_id: X.suppliers[0].id }]);
  });
  it("needs a witness again when the mode is witnessed", async () => {
    await setOpening({ mode: "witnessed", envelopes: "single" });
    const id = await ev("closed"), v = (await row(id)).v;
    expect(err(await openAllEnvelopes(pool, who("buyer"), id, v))).toMatch(/witness/i);
    expect(err(await openAllEnvelopes(pool, who("buyer"), id, v, X.people.witness.membershipId))).toMatch(/not confirmed/i);
  });
  it("does nothing when there are no bids", async () => {
    await setOpening({ mode: "buyer", envelopes: "single" });
    const id = await ev("closed", { bids: false }), v = (await row(id)).v;
    expect(err(await openAllEnvelopes(pool, who("buyer"), id, v))).toMatch(/No bids/i);
  });
});

describe("rules by event value", () => {
  it("uses the stricter way for big events and the lighter way for small ones", async () => {
    await setOpening({ mode: "buyer", envelopes: "two", tiers: [{ minValue: 100000, mode: "witnessed" }] });
    const big = await ev("closed", { value: 400000 }), small = await ev("closed", { value: 50000 }), unknown = await ev("closed", { value: null });
    expect(err(await openTechnicalEnvelopes(pool, who("buyer"), big, (await row(big)).v))).toMatch(/witness/i);
    expect(err(await openTechnicalEnvelopes(pool, who("buyer"), unknown, (await row(unknown)).v))).toMatch(/witness/i);
    expect(await openTechnicalEnvelopes(pool, who("buyer"), small, (await row(small)).v)).toMatchObject({ ok: true });
    expect((await records(small))[0]).toMatchObject({ opened_mode: "buyer" });
  });
});

describe("settings frozen at publication", () => {
  it("keeps the way an event was published with, whatever the company changes later", async () => {
    await setOpening({ mode: "witnessed", envelopes: "two" });
    const id = await ev("closed"), v = (await row(id)).v;
    await admin.query(`update sourcing_event set config_snapshot = $2 where id = $1`, [id, JSON.stringify({ evaluation: { ...DEFAULT_CONFIG, opening: { mode: "buyer", envelopes: "two" } } })]);
    expect(await openTechnicalEnvelopes(pool, who("buyer"), id, v)).toMatchObject({ ok: true });
    expect((await records(id))[0]).toMatchObject({ opened_mode: "buyer" });
  });
  it("treats an event published before this setting existed as witnessed", async () => {
    await setOpening({ mode: "buyer", envelopes: "two" });
    const id = await ev("closed"), v = (await row(id)).v;
    await admin.query(`update sourcing_event set config_snapshot = $2 where id = $1`, [id, JSON.stringify({ evaluation: { ...DEFAULT_CONFIG } })]);
    expect(err(await openTechnicalEnvelopes(pool, who("buyer"), id, v))).toMatch(/witness/i);
  });
});
