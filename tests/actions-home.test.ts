import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { myActions } from "@/dashboard/service";
import { pendingCount, requestDecision, decide } from "@/decisions/service";
import { workspaceOf } from "@/events/readiness";
import type { Who } from "@/events/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role: "member" } as Who);
const ver = async (id: string) => (await admin.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "actions"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("My actions home", () => {
  it("shows a confirmation to the witness, the wait to the buyer, then the go-ahead", async () => {
    const e = await makeEvent(admin, X, "closed", { withBids: false });
    const v = await ver(e.id);
    const w = X.people.witness.membershipId;
    const r = await requestDecision(pool, who("buyer"), e.id, v, "OpenEnvelope1", { witnessMembershipId: w });
    if (!r.ok) throw new Error(r.error);

    const witness = await myActions(pool, who("witness"));
    expect(witness.now.some((a) => a.eventId === e.id && a.href === "/decisions" && a.text === "Confirm: {0}")).toBe(true);
    expect(await pendingCount(pool, who("witness"))).toBeGreaterThan(0);
    expect(await pendingCount(pool, who("buyer"))).toBe(0);

    const buyer = await myActions(pool, who("buyer"));
    expect(buyer.waiting.some((a) => a.eventId === e.id && a.text === "Waiting for {0} to confirm: {1}")).toBe(true);

    await decide(pool, who("witness"), r.requestId, true);
    expect((await myActions(pool, who("witness"))).now.some((a) => a.href === "/decisions" && a.eventId === e.id)).toBe(false);
    const after = await myActions(pool, who("buyer"));
    expect(after.now.some((a) => a.eventId === e.id && a.text.includes("confirmed"))).toBe(true);
    expect(after.waiting.some((a) => a.eventId === e.id && a.text.startsWith("Waiting for {0}"))).toBe(false);
  });

  it("lists events closing within a week, and what the buyer waits on", async () => {
    const soon = await makeEvent(admin, X, "published", { withBids: false });
    await admin.query(`update sourcing_event set closes_at = now() + interval '2 days' where id = $1`, [soon.id]);
    const later = await makeEvent(admin, X, "published", { withBids: false });
    await admin.query(`update sourcing_event set closes_at = now() + interval '30 days' where id = $1`, [later.id]);
    const pend = await makeEvent(admin, X, "pending_award", { withBids: false });
    const a = await myActions(pool, who("buyer"));
    expect(a.soon.some((x) => x.eventId === soon.id)).toBe(true);
    expect(a.soon.some((x) => x.eventId === later.id)).toBe(false);
    expect(a.waiting.some((x) => x.eventId === pend.id && x.text === "Waiting for award approval")).toBe(true);
    expect((await myActions(pool, who("witness"))).soon.length).toBe(0);
  });
});

describe("event workspace pointers", () => {
  const base = { state: "draft", title: "Pumps", closesAt: null as string | null, itemCount: 0, itemsWithLots: true, lotsNeeded: false, teamRoles: [] as string[], myRoles: ["buyer"] as never[], isAdmin: false, docCount: 0 };
  it("points the draft at the tab where the next missing step is done", () => {
    expect(workspaceOf(base).tab).toBe("overview");
    expect(workspaceOf({ ...base, closesAt: "2026-12-01" }).tab).toBe("items");
    expect(workspaceOf({ ...base, closesAt: "2026-12-01", itemCount: 2 }).tab).toBe("team");
  });
  it("says whose step it is when it is not mine", () => {
    const w = workspaceOf({ ...base, state: "pending_award", myRoles: [] });
    expect(w.waitingRole).toBe("award_approver");
    expect(w.tab).toBeUndefined();
    expect(workspaceOf({ ...base, state: "pending_award", myRoles: ["award_approver"] as never[] })).toMatchObject({ tab: "eval", waitingRole: undefined });
  });
});
