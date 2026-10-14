import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPreview } from "@/templates/preview";
import { listLibrary, templatePreview } from "@/templates/service";
import type { TemplateContent } from "@/templates/types";
import type { Who } from "@/events/service";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";

const L = (en: string) => ({ en, ar: en + " (ar)" });
const content: TemplateContent = {
  schema: 1, sections: [{ key: "s1", label: L("Scope") }],
  fields: [
    { key: "tag", section: "s1", label: L("Tag"), type: "text", source: "buyer", envelope: "technical", required: true },
    { key: "note", section: "s1", label: L("Note"), type: "longtext", source: "buyer", envelope: "technical" },
    { key: "wty", section: "s1", label: L("Warranty"), type: "integer", source: "supplier", envelope: "commercial", required: "tag != \"\"" },
  ],
  questions: [{ key: "q1", section: "s1", label: L("Approved vendor?"), type: "yesno", use: "qualification", required: true, evidence: true }],
  documents: [{ key: "d1", label: L("Licence"), purpose: L("Proves registration"), required: true, origin: "suggested", envelope: "technical", fileTypes: ["pdf"], expiry: true }],
  pricing: { model: "itemized", groups: [], lines: [{ key: "l1", description: L("Pump"), quantity: "1", unit: "EA", block: "UNIT_PRICE" }, { key: "l2", description: L("Spares"), quantity: "1", unit: "LS", block: "LUMP_SUM", optional: true }] },
  evaluation: { modes: ["weighted"], mode: "weighted", scale: { min: 0, max: 10 }, criteria: [{ key: "c1", label: L("Experience") }] },
  workflow: [],
};

describe("buildPreview", () => {
  it("lists what a template contains with needs, envelopes and pricing", () => {
    const p = buildPreview({ key: "X", title: L("T"), summary: L("S"), eventType: "RFQ", version: 2 }, content);
    expect(p.counts).toEqual({ fields: 2, questions: 2, documents: 1, lines: 2, criteria: 1 });
    expect(p.fields.map((f) => f.need)).toEqual(["required", "optional"]);
    expect(p.questions.map((q) => [q.use, q.need])).toEqual([["qualification", "required"], ["info", "conditional"]]);
    expect(p.documents[0]).toMatchObject({ need: "required", expiry: true, fileTypes: ["pdf"] });
    expect(p.pricing.lines.map((l) => [l.how, l.optional])).toEqual([["unit", false], ["lump", true]]);
    expect(p.envelopes).toBe(2);
    expect(p.evaluation.criteria[0]!.ar).toBe("Experience (ar)");
  });
});

let admin: Client, pool: Pool, X: World;
const who = (p: keyof World["people"]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role: "member" } as Who);
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "tplprev"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("templatePreview", () => {
  it("returns the contents of a library template, and nothing for unknown or malformed keys", async () => {
    const lib = await listLibrary(pool, who("buyer"));
    expect(lib.length).toBeGreaterThan(0);
    const p = await templatePreview(pool, who("buyer"), lib[0]!.key);
    expect(p).not.toBeNull();
    expect(p!.key).toBe(lib[0]!.key);
    expect(p!.counts.questions + p!.counts.fields + p!.counts.documents + p!.counts.lines).toBeGreaterThan(0);
    expect(await templatePreview(pool, who("buyer"), "NOPE_NOT_A_TEMPLATE")).toBeNull();
    expect(await templatePreview(pool, who("buyer"), "x'; drop table t; --")).toBeNull();
  });
});
