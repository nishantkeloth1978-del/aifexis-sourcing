import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";
import type { Who } from "@/events/service";
import { saveRoute, simulateApprovals } from "@/events/routing";

let admin: Client, pool: Pool, X: World;
const as = (p: keyof World["people"], role = "member"): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role });
const A = () => as("admin", "admin");
beforeAll(async () => { admin = await adminClient(); pool = makePool(10); X = await seedTenant(admin, "SIM"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("approval simulation", () => {
  it("is admin only and validates input", async () => {
    expect((await simulateApprovals(pool, as("buyer"), { valueAed: 1 })).ok).toBe(false);
    expect((await simulateApprovals(pool, A(), { valueAed: -5 })).ok).toBe(false);
    expect((await simulateApprovals(pool, A(), { valueAed: 5, onDate: "tomorrow" })).ok).toBe(false);
  });
  it("warns about missing routes, then seats the owner or the deputy by date", async () => {
    const r0 = await simulateApprovals(pool, A(), { valueAed: 1000, onDate: "2026-06-10" });
    if (!r0.ok) throw new Error(r0.error);
    expect(r0.simulation.warnings.some((w) => w.code === "none" && w.step === "award")).toBe(true);
    const owner = X.people.pubApprover.membershipId, dep = X.people.admin.membershipId;
    expect((await saveRoute(pool, A(), { step: "award", slot: 1, ownerId: owner, deputyId: dep, awayFrom: "2026-06-01", awayTo: "2026-06-30" })).ok).toBe(true);
    const away = await simulateApprovals(pool, A(), { valueAed: 1000, onDate: "2026-06-10" });
    const back = await simulateApprovals(pool, A(), { valueAed: 1000, onDate: "2026-07-10" });
    if (!away.ok || !back.ok) throw new Error("sim failed");
    const aw = (x: typeof away) => x.simulation.steps.find((s) => s.step === "award")!;
    expect(aw(away).seated[0]!.via).toBe("deputy");
    expect(aw(back).seated[0]!.via).toBe("owner");
    expect(aw(back).seated).toHaveLength(1);
  });
  it("flags one person approving two steps", async () => {
    const p = X.people.pubApprover.membershipId;
    await saveRoute(pool, A(), { step: "publication", slot: 1, ownerId: p });
    const r = await simulateApprovals(pool, A(), { valueAed: 1000, onDate: "2026-07-10" });
    if (!r.ok) throw new Error(r.error);
    if (!r.simulation.autoPublish) expect(r.simulation.warnings.some((w) => w.code === "same")).toBe(true);
    else expect(r.simulation.steps[0]!.needed).toBe(0);
  });
});
