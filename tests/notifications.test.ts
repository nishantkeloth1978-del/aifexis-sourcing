import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveAwardNow } from "@/commercial/service";
import type { Who } from "@/events/service";
import { listNotes, markAllRead, unreadCount } from "@/notifications/service";
import { getAwardPack } from "@/pack/service";
import { inviteSupplier } from "@/suppliers/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const staff = (p: keyof World["people"], role = "member"): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role } as Who);
const supUser = async (i: 0 | 1 | 2) => (await admin.query(`select user_id from supplier_user where id = $1`, [X.suppliers[i].supplierUserId])).rows[0].user_id as string;
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "notif"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("notifications", () => {
  it("tells a supplier it was invited, and nobody else", async () => {
    const e = await makeEvent(admin, X, "published", { invite: [], withBids: false });
    expect(await inviteSupplier(pool, staff("buyer"), e.id, X.suppliers[0].id)).toMatchObject({ ok: true });
    const mine = await listNotes(pool, X.tenantId, await supUser(0));
    expect(mine[0]).toMatchObject({ kind: "invited", unread: true });
    expect(await listNotes(pool, X.tenantId, await supUser(1))).toEqual([]);
    expect(await unreadCount(pool, X.tenantId, await supUser(0))).toBe(1);
    await markAllRead(pool, X.tenantId, await supUser(0));
    expect(await unreadCount(pool, X.tenantId, await supUser(0))).toBe(0);
  });
  it("tells every bidder how the award went, without naming the winner to the others", async () => {
    const e = await makeEvent(admin, X, "pending_award");
    await admin.query(`insert into recommendation (tenant_id, event_id, supplier_id, note, created_by) values ($1,$2,$3,'Best weighted score overall',$4)`, [X.tenantId, e.id, X.suppliers[0].id, X.people.buyer.membershipId]);
    const v = (await admin.query(`select state_version from sourcing_event where id = $1`, [e.id])).rows[0].state_version as number;
    expect(await approveAwardNow(pool, staff("awardApprover"), e.id, v)).toMatchObject({ ok: true });
    const win = (await listNotes(pool, X.tenantId, await supUser(0))).find((n) => n.kind === "award_result");
    const lose = (await listNotes(pool, X.tenantId, await supUser(1))).find((n) => n.kind === "award_result");
    expect(win?.message).toContain("successful");
    expect(lose?.message).toContain("another bidder");
    expect(lose?.message).not.toContain(X.suppliers[0].id);
    expect((await listNotes(pool, X.tenantId, X.people.buyer.userId)).some((n) => n.kind === "awarded")).toBe(true);
    const pack = await getAwardPack(pool, staff("buyer"), e.id);
    expect(pack).toMatchObject({ event: { state: "awarded" }, recommendation: { note: "Best weighted score overall" } });
    expect(pack!.approvals).toHaveLength(1);
    expect(pack!.trail.some((a) => a.action === "award.approved")).toBe(true);
    expect(await getAwardPack(pool, staff("techA"), e.id)).toBeNull();
    expect(randomUUID()).toBeTruthy();
  });
});
