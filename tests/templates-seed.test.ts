import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACKS_1, PACKS_2, TEMPLATES_1, TEMPLATES_2 } from "../src/templates/packs";

describe("template seed", () => {
  it.each([["0019_template_seed.sql", PACKS_1, TEMPLATES_1], ["0020_template_packs_2.sql", PACKS_2, TEMPLATES_2]] as const)("%s contains every template and pack from the TypeScript masters", (file, packs, templates) => {
    const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
    for (const t of templates) expect(sql, t.meta.key).toContain(`'${t.meta.key}'`);
    for (const p of packs) expect(sql, p.code).toContain(`'${p.code}'`);
  });
  it("every pack's industries exist and every template's category is seeded", () => {
    const sql = ["0018_templates.sql", "0020_template_packs_2.sql"].map((f) => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
    for (const p of PACKS_2) for (const i of p.industryCodes) expect(sql, i).toContain(`('${i}',`);
    for (const t of TEMPLATES_2) expect(sql, t.meta.categoryCode).toContain(`('${t.meta.categoryCode}',`);
  });
});
