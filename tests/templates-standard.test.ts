import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_TEMPLATES, TEMPLATES_3 } from "../src/templates/packs";
import { validateContent } from "../src/templates/validate";

describe("market-standard release (version 2)", () => {
  it("produces version 2 of every template, and the migration contains them all", () => {
    expect(TEMPLATES_3).toHaveLength(ALL_TEMPLATES.length);
    const sql = readFileSync("supabase/migrations/0027_templates_market_standard.sql", "utf8");
    for (const t of TEMPLATES_3) { expect(t.version).toBe(2); expect(sql).toContain(`'${t.meta.key}', 2,`); }
  });
  it.each(TEMPLATES_3.map((t) => [t.meta.key, t] as const))("%s is valid and keeps every original object", (_k, t) => {
    const base = ALL_TEMPLATES.find((b) => b.meta.key === t.meta.key)!;
    const sections = new Set(["general", "technical", "commercial", "equipment", "service", "warranty", "mobilisation"]);
    const content = { ...t.content, sections: [...sections].map((key) => ({ key, label: { en: key, ar: key } })) };
    expect(validateContent(content as never)).toEqual([]);
    for (const col of ["fields", "questions", "documents"] as const) for (const o of base.content[col]) expect(t.content[col].some((x) => x.key === o.key), `${col}:${o.key}`).toBe(true);
  });
  it("General RFQ now carries the standard header, terms, declarations and documents", () => {
    const c = TEMPLATES_3.find((t) => t.meta.key === "GEN_RFQ")!.content;
    for (const k of ["incoterms", "delivery_location", "required_date", "bid_bond_percent", "country_of_origin", "hs_code", "min_order_qty", "vat_treatment"]) expect(c.fields.map((f) => f.key), k).toContain(k);
    for (const k of ["sanctions_declaration", "anti_bribery", "accept_terms", "deviations"]) expect(c.questions.map((q) => q.key), k).toContain(k);
    for (const k of ["trade_licence", "tax_registration", "bid_bond", "datasheets"]) expect(c.documents.map((d) => d.key), k).toContain(k);
    expect(c.evaluation.criteria.length).toBeGreaterThan(0);
  });
});
