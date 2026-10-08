import { describe, expect, it } from "vitest";
import { priceBid } from "@/bids/service";
import { evaluate, parse, refs } from "@/templates/expr";
import { ALL_TEMPLATES } from "@/templates/packs";
import { resolve } from "@/templates/resolve";
import { buildSchedule } from "@/templates/schedule";
import { commercialScore, combinedScore, technicalScore } from "@/templates/evaluation";
import { overrideBreaksPolicy, validateContent, validateEffective } from "@/templates/validate";
import type { TemplateContent } from "@/templates/types";

const T = (key: string) => ALL_TEMPLATES.find((t) => t.meta.key === key)!;
const num = (s: string, env = {}) => evaluate(parse(s), env);

describe("expression language", () => {
  it("does exact decimal arithmetic and booleans", () => {
    expect(num("2 * 3 + 1")).toBe(7_000_000n);
    expect(num("0.1 + 0.2")).toBe(300_000n);                       // no floating point drift
    expect(num("headcount * days", { headcount: 100, days: 30 })).toBe(3_000_000_000n);
    expect(num('type == "a" and not (qty > 5)', { type: "a", qty: 2 })).toBe(true);
    expect(num('brand in ["x", "y"]', { brand: "y" })).toBe(true);
    expect(num("days * 2", {})).toBeNull();                         // unknown stays unknown
    expect(num("flag == true or other == 1", { other: 1 })).toBe(true);
  });
  it("rejects anything that is not the grammar", () => {
    for (const bad of ["process.exit()", "a ? b : c", "a = 1", "1 +", "[1,2]", "x;y", "`a`", "a.b.c(1)"]) expect(() => parse(bad)).toThrow();
    expect(() => num("1 / 0")).toThrow();
    expect(refs(parse("a + b * c > d"))).toEqual(["a", "b", "c", "d"]);
  });
});

describe("shipped templates", () => {
  it("are valid on their own and in every layer combination", () => {
    for (const t of ALL_TEMPLATES) {
      const r = resolve(t.content);
      expect(validateEffective(r.effective, { policies: [], requires: t.meta.requires }).errors, t.meta.key).toEqual([]);
      expect(r.problems).toEqual([]);
      expect(r.hash).toBe(resolve(t.content).hash);               // same inputs, same hash
    }
  });
  it("have English and Arabic text everywhere", () => {
    const miss: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (typeof o.en === "string" && typeof o.ar === "string") { if (!o.en.trim() || !o.ar.trim()) miss.push(path); } else for (const [k, x] of Object.entries(o)) walk(x, `${path}.${k}`);
      }
    };
    for (const t of ALL_TEMPLATES) { walk(t.content, t.meta.key); walk([t.meta.title, t.meta.summary], t.meta.key + ".meta"); }
    expect(miss).toEqual([]);
  });
  it("marks suggested documents as suggested and never makes a certificate mandatory", () => {
    for (const t of ALL_TEMPLATES) for (const d of t.content.documents) { expect(d.origin).toBe("suggested"); expect(d.required).toBe(false); }
  });
});

describe("layered configuration", () => {
  it("merges by key, tracks where each value came from, and applies add/update/remove", () => {
    const base = T("AV_EQUIPMENT_RFQ").content;
    const r = resolve(base, [
      { collection: "fields", objectKey: "warranty_months", op: "update", value: { label: { en: "Warranty (months)", ar: "الضمان (أشهر)" } } },
      { collection: "fields", objectKey: "site_code", op: "add", value: { section: "general", label: { en: "Site code", ar: "رمز الموقع" }, type: "text", source: "buyer", envelope: "technical", required: true } },
      { collection: "documents", objectKey: "company_profile", op: "remove" },
    ]);
    const f = r.effective.fields.find((x) => x.key === "warranty_months")!;
    expect(f.label.en).toBe("Warranty (months)"); expect(f.type).toBe("integer"); expect(f.required).toBe(true);   // label changed, meaning kept
    expect(r.effective.provenance["fields:warranty_months"]).toBe("company");
    expect(r.effective.provenance["fields:brand"]).toBe("template");
    expect(r.effective.provenance["sections:general"]).toBe("base");
    expect(r.effective.provenance["fields:site_code"]).toBe("company");
    expect(r.effective.documents.find((d) => d.key === "company_profile")).toBeUndefined();
    expect(r.problems).toEqual([]);
    // a label change does not change the identity of the field
    expect(r.effective.fields.map((x) => x.key)).toContain("warranty_months");
    // bad operations are reported, not applied
    const bad = resolve(base, [{ collection: "fields", objectKey: "brand", op: "add", value: {} }, { collection: "fields", objectKey: "nope", op: "update", value: {} }]);
    expect(bad.problems.map((p) => p.code)).toEqual(["DUPLICATE_KEY", "MISSING_TARGET"]);
  });
  it("blocks overrides that weaken a confirmed company policy (AC09) and lists unconfirmed ones", () => {
    const policies = [{ key: "need-warranty", kind: "require_field" as const, target: "warranty_months", confirmed: true }, { key: "bond", kind: "require_document" as const, target: "datasheets", confirmed: false }];
    expect(overrideBreaksPolicy({ collection: "fields", objectKey: "warranty_months", op: "remove" }, policies)).toMatchObject({ code: "POLICY_LOCKED", key: "policy:need-warranty" });
    expect(overrideBreaksPolicy({ collection: "fields", objectKey: "warranty_months", op: "update", value: { required: false } }, policies)).toMatchObject({ code: "POLICY_LOCKED" });
    expect(overrideBreaksPolicy({ collection: "fields", objectKey: "warranty_months", op: "update", value: { label: { en: "x", ar: "y" } } }, policies)).toBeNull();
    expect(overrideBreaksPolicy({ collection: "documents", objectKey: "datasheets", op: "remove" }, policies)).toBeNull();   // unconfirmed policy locks nothing
    const ov = [{ collection: "fields" as const, objectKey: "warranty_months", op: "remove" as const, scope: "company" }];
    const r = resolve(T("AV_EQUIPMENT_RFQ").content, ov);
    const v = validateEffective(r.effective, { policies, overrides: ov });
    expect(v.errors.map((e) => e.code)).toContain("POLICY_LOCKED");
    expect(v.unresolved.map((e) => e.code)).toEqual(["POLICY_UNCONFIRMED"]);
  });
  it("detects condition cycles, broken references, envelope leaks and conflicting scoped overrides (AC10)", () => {
    const c: TemplateContent = JSON.parse(JSON.stringify(T("GEN_RFQ").content));
    c.fields.push({ key: "a", section: "general", label: { en: "A", ar: "أ" }, type: "boolean", source: "supplier", envelope: "technical", required: "b == true" });
    c.fields.push({ key: "b", section: "general", label: { en: "B", ar: "ب" }, type: "boolean", source: "supplier", envelope: "technical", required: "a == true" });
    c.fields.push({ key: "c", section: "nowhere", label: { en: "C", ar: "ج" }, type: "text", source: "supplier", envelope: "technical", required: "ghost == 1" });
    c.fields.push({ key: "d", section: "general", label: { en: "D", ar: "د" }, type: "text", source: "supplier", envelope: "technical", visible: "offer_validity_days > 30" });   // commercial field
    c.fields.push({ key: "a", section: "general", label: { en: "dup", ar: "مكرر" }, type: "text", source: "supplier", envelope: "technical" });
    const codes = validateContent(c).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["CONDITION_CYCLE", "BROKEN_REFERENCE", "ENVELOPE_LEAK", "DUPLICATE_KEY"]));
    const conflict = validateEffective(resolve(T("GEN_RFQ").content).effective, { policies: [], overrides: [
      { collection: "fields", objectKey: "lead_time_days", op: "update", value: {}, scope: "dept:ops", templateKey: "GEN_RFQ" }, { collection: "fields", objectKey: "lead_time_days", op: "update", value: {}, scope: "dept:ops", templateKey: "GEN_RFQ" }] });
    expect(conflict.errors).toEqual([expect.objectContaining({ code: "OVERRIDE_CONFLICT", key: "fields:lead_time_days" })]);
  });
  it("refuses templates that need capabilities this deployment lacks (AC07)", () => {
    const v = validateEffective(resolve(T("GEN_RFQ").content).effective, { policies: [], requires: ["rfx", "auction"] });
    expect(v.errors).toEqual([expect.objectContaining({ code: "UNSUPPORTED_CAPABILITY", message: expect.stringContaining("Reverse auction") })]);
  });
});

describe("pricing fixtures through the real pricing engine", () => {
  const priced = (items: { id: string; lineNo: number; quantity: string; blockType: string }[], prices: Record<string, string>) =>
    priceBid(items.map((i) => ({ ...i, description: "x", unit: "EA", lotId: null })) as never, prices);
  it("AV: five displays at AED 2,000 plus one installation charge is AED 11,500, counted once (AC17)", () => {
    const sched = buildSchedule(resolve(T("AV_EQUIPMENT_RFQ").content).effective, { groups: {}, include: ["installation"] });
    expect(sched).toMatchObject({ incomplete: false }); expect(sched.items.map((i) => [i.lineKey, i.quantity, i.blockType])).toEqual([["installation", "1.000", "LUMP_SUM"]]);
    const items = [{ id: "d", lineNo: 1, quantity: "5", blockType: "UNIT_PRICE" }, { id: "i", lineNo: 2, quantity: sched.items[0]!.quantity, blockType: "LUMP_SUM" }];
    expect(priced(items, { d: "2000", i: "1500" })).toMatchObject({ ok: true, total: "11500.00" });
    // not requested: the installation line is simply absent
    expect(buildSchedule(resolve(T("AV_EQUIPMENT_RFQ").content).effective, { groups: {} }).items).toEqual([]);
  });
  it("Catering: 100 people x 30 days x 25 + 5,000 mobilisation is AED 80,000; missing days is incomplete, never guessed (AC18)", () => {
    const e = resolve(T("CAT_MEAL_SERVICE_RFP").content).effective;
    const ok = buildSchedule(e, { groups: { site: [{ name: "Vessel A", headcount: 100, days: 30, mobilisation: true }] } });
    expect(ok).toMatchObject({ incomplete: false });
    expect(ok.items.map((i) => [i.description, i.quantity, i.unit])).toEqual([["Meal service: Vessel A", "3000.000", "PERSON-DAY"], ["Mobilisation: Vessel A", "1.000", "LS"]]);
    expect(priced([{ id: "s", lineNo: 1, quantity: ok.items[0]!.quantity, blockType: "UNIT_PRICE" }, { id: "m", lineNo: 2, quantity: ok.items[1]!.quantity, blockType: "LUMP_SUM" }], { s: "25", m: "5000" })).toMatchObject({ total: "80000.00" });
    const gap = buildSchedule(e, { groups: { site: [{ name: "Vessel A", headcount: 100, days: "" }] } });
    expect(gap).toMatchObject({ incomplete: true, missing: [{ group: "site", row: 0, input: "days", why: "missing" }] }); expect(gap.items).toEqual([]);
    const two = buildSchedule(e, { groups: { site: [{ name: "A", headcount: 10, days: 5, mobilisation: true }, { name: "B", headcount: 20, days: 2, mobilisation: false }] } });
    expect(two.items.map((i) => i.description)).toEqual(["Meal service: A", "Mobilisation: A", "Meal service: B"]);     // mobilisation only where offered
    expect(buildSchedule(e, { groups: { site: [{ name: "A", headcount: 10, days: 0 }] } })).toMatchObject({ incomplete: true });
    expect(buildSchedule(e, { groups: {} })).toMatchObject({ incomplete: true });
  });
  it("manpower and subscription models produce hours and unit-months", () => {
    const m = buildSchedule(resolve(T("CAT_KITCHEN_OPERATION_RFP").content).effective, { groups: { role: [{ name: "Cook", staff: 4, hours: 160, overtime_hours: 10 }, { name: "Helper", staff: 6, hours: 160 }] } });
    expect(m.items.map((i) => [i.description, i.quantity])).toEqual([["Normal hours: Cook", "640.000"], ["Overtime hours: Cook", "40.000"], ["Normal hours: Helper", "960.000"]]);
    const s = buildSchedule(resolve(T("AV_MAINTENANCE_RFP").content).effective, { groups: { coverage: [{ name: "HQ", units: 12, months: 12 }] }, include: ["onboarding"] });
    expect(s.items.map((i) => [i.lineKey, i.quantity])).toEqual([["recurring", "144.000"], ["onboarding", "1.000"]]);
  });
});

describe("evaluation fixture", () => {
  it("technical 72, commercial 80, combined 74.4 (AC20)", () => {
    expect(technicalScore([4, 3], [60, 40], { min: 0, max: 5 })).toEqual({ ok: true, score: "72" });
    expect(commercialScore("125000", "100000")).toEqual({ ok: true, score: "80" });
    expect(combinedScore("72", "80", 70, 30)).toBe("74.4");
    expect(technicalScore([4, 3], [50, 40], { min: 0, max: 5 })).toMatchObject({ ok: false });
    expect(technicalScore([6, 3], [60, 40], { min: 0, max: 5 })).toMatchObject({ ok: false });
    expect(commercialScore("0", "100000")).toMatchObject({ ok: false, review: true });
    expect(combinedScore("72", "80", 70, 20)).toBeNull();
  });
});
