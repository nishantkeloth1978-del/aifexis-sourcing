import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/authz";
import { DEFAULT_CONFIG, getConfig, resolveConfig, saveConfig } from "@/config/service";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (role: string): Who => ({ tenantId: X.tenantId, userId: X.people.admin.userId, membershipId: X.people.admin.membershipId, role } as Who);
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "cfg"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("evaluation configuration", () => {
  it("defaults, validates, versions, and is admin only", async () => {
    expect((await getConfig(pool, who("admin"))).config).toEqual(DEFAULT_CONFIG);
    const mine = { criteria: ["Quality", "Delivery"], weights: { technical: 50, commercial: 50 }, qualifyAt: 60, closeMargin: 1.5 };
    expect(await saveConfig(pool, who("member"), mine)).toMatchObject({ ok: false });
    expect(await saveConfig(pool, who("admin"), { ...mine, weights: { technical: 60, commercial: 60 } })).toMatchObject({ ok: false });
    expect(await saveConfig(pool, who("admin"), { ...mine, criteria: ["A", "A "] })).toMatchObject({ ok: false });
    expect(await saveConfig(pool, who("admin"), { ...mine, criteria: [] })).toMatchObject({ ok: false });
    expect(await saveConfig(pool, who("admin"), { ...mine, qualifyAt: 101 })).toMatchObject({ ok: false });
    const saved = await saveConfig(pool, who("admin"), mine);
    expect(saved).toMatchObject({ ok: true, version: 2 });
    expect((await getConfig(pool, who("admin"))).config).toEqual({ ...mine, gates: [] });
  });
  it("a published event keeps the configuration it was published with", async () => {
    const e = await makeEvent(admin, X, "published");
    await admin.query(`update sourcing_event set config_snapshot = $2 where id = $1`, [e.id, JSON.stringify({ evaluation: DEFAULT_CONFIG })]);
    await saveConfig(pool, who("admin"), { criteria: ["Only one"], weights: { technical: 10, commercial: 90 }, qualifyAt: 50, closeMargin: 1 });
    expect((await withTenant(pool, X.tenantId, (c) => resolveConfig(c, e.id))).criteria).toHaveLength(4);
    expect((await withTenant(pool, X.tenantId, (c) => resolveConfig(c))).criteria).toEqual(["Only one"]);
  });
});
