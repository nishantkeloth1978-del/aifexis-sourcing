import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { myTasks } from "@/dashboard/service";
import type { Who } from "@/events/service";
import { toCsv } from "@/export/csv";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const staff = (p: keyof World["people"]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role: "member" } as Who);
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "dash"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("csv", () => {
  it("quotes, keeps Arabic, and defuses formulas", () => {
    const out = toCsv([["a,b", 'say "hi"', "مورد", "=1+1", "-5", "-x"]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toContain('"a,b","say ""hi""",مورد,\'=1+1,-5,\'-x');
  });
});

describe("my tasks", () => {
  it("shows each person only what is theirs, from where each event stands", async () => {
    const closed = await makeEvent(admin, X, "closed", { withBids: false });
    const pend = await makeEvent(admin, X, "pending_award", { withBids: false });
    const tech = await makeEvent(admin, X, "technical_evaluation");
    await admin.query(`delete from tech_score where event_id = $1`, [tech.id]);
    const buyer = await myTasks(pool, staff("buyer"));
    expect(buyer.some((t) => t.eventId === closed.id && /technical envelopes/.test(t.text))).toBe(true);
    expect(buyer.some((t) => t.eventId === pend.id)).toBe(false);
    expect((await myTasks(pool, staff("awardApprover"))).some((t) => t.eventId === pend.id && /award/.test(t.text))).toBe(true);
    expect((await myTasks(pool, staff("awardApprover"))).some((t) => t.eventId === closed.id)).toBe(false);
    expect((await myTasks(pool, staff("techA"))).some((t) => t.eventId === tech.id && /Score 3 bidders/.test(t.text))).toBe(true);
    expect((await myTasks(pool, staff("witness"))).length).toBe(0);
  });
});
