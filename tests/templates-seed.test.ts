import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_TEMPLATES, PACKS } from "../src/templates/packs";

describe("template seed", () => {
  it("0019 contains every template and pack from the TypeScript masters", () => {
    const sql = readFileSync("supabase/migrations/0019_template_seed.sql", "utf8");
    for (const t of ALL_TEMPLATES) expect(sql, t.meta.key).toContain(`'${t.meta.key}'`);
    for (const p of PACKS) expect(sql, p.code).toContain(`'${p.code}'`);
  });
});
