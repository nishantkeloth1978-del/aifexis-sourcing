import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listEvents, listEventsPage } from "@/events/service";
import type { Who } from "@/events/service";
import { allow, rateLimit } from "@/lib/ratelimit";
import { buildCsp, newNonce } from "@/lib/csp";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"], role = "member"): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role } as Who);
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "scale"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("server-side pagination of events", () => {
  it("pages, filters by status group, searches, and counts in the database", async () => {
    for (let i = 0; i < 7; i++) await makeEvent(admin, X, "draft", { withBids: false });
    const open = await makeEvent(admin, X, "published", { withBids: false });
    await admin.query(`update sourcing_event set title = 'Zebra Crossing Paint 50%_x' where id = $1`, [open.id]);
    const buyer = who("buyer");
    const all = (await listEventsPage(pool, buyer, { pageSize: 5 }));
    expect(all.rows.length).toBe(5);
    expect(all.total).toBeGreaterThanOrEqual(8);
    expect(all.pages).toBe(Math.ceil(all.total / 5));
    const last = await listEventsPage(pool, buyer, { pageSize: 5, page: 999 });   // out-of-range page is clamped
    expect(last.page).toBe(last.pages);
    expect(new Set([...all.rows, ...(await listEventsPage(pool, buyer, { pageSize: 5, page: 2 })).rows].map((r) => r.id)).size).toBe(Math.min(10, all.total));   // pages do not overlap
    const drafts = await listEventsPage(pool, buyer, { group: "Draft" });
    expect(drafts.rows.every((r) => ["draft", "pending_publication"].includes(r.state))).toBe(true);
    expect((await listEventsPage(pool, buyer, { group: "Open" })).rows.map((r) => r.id)).toContain(open.id);
    expect((await listEventsPage(pool, buyer, { q: "zebra crossing" })).rows.map((r) => r.id)).toEqual([open.id]);
    expect((await listEventsPage(pool, buyer, { q: "50%_x" })).rows.map((r) => r.id)).toEqual([open.id]);     // % and _ are text, not wildcards
    expect((await listEventsPage(pool, buyer, { q: "%" })).rows.length).toBe(1);
    expect(all.counts.total).toBe(all.total);
    expect(all.counts.open).toBeGreaterThanOrEqual(1);
    expect((await listEvents(pool, buyer, 3)).length).toBe(3);
  });
  it("keeps visibility rules: a person without 'see every event' sees only their own", async () => {
    const solo = await makeEvent(admin, X, "draft", { withBids: false });
    await admin.query(`delete from event_member where event_id = $1`, [solo.id]);
    await admin.query(`update sourcing_event set created_by = $2 where id = $1`, [solo.id, X.people.admin.membershipId]);
    const ids = (p: keyof World["people"]) => listEventsPage(pool, who(p), { pageSize: 100 }).then((r) => r.rows.map((x) => x.id));
    expect(await ids("buyer")).not.toContain(solo.id);
    expect(await ids("admin")).toContain(solo.id);
  });
});

describe("rate limiter failing", () => {
  const broken = { query: async () => { throw new Error("db down"); } } as unknown as Pool;
  it("lets ordinary actions through but refuses guards against guessing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await rateLimit(broken, "act:x", 60, 10)).toBe(true);
    expect(await rateLimit(broken, "login:x", 60, 10, { failClosed: true })).toBe(false);
    expect(await allow(broken, [["a", 60, 1]])).toBe(true);
    expect(await allow(broken, [["a", 60, 1]], { failClosed: true })).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("content security policy", () => {
  it("allows scripts only with the response's nonce, and no inline script", () => {
    const n = newNonce();
    expect(n).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(newNonce()).not.toBe(n);
    const csp = buildCsp(n, { supabase: "https://x.supabase.co" });
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toContain(`'nonce-${n}'`);
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(buildCsp(n, { dev: true })).toContain("'unsafe-eval'");
  });
});
