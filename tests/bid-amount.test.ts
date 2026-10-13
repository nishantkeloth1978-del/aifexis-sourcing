import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lineAmount } from "@/boq/amount";

const item = { id: "a", lineNo: 1, quantity: "10", blockType: "UNIT_PRICE" };
describe("supplier-side line amount with price breaks", () => {
  it("follows the break price, not only the base price", () => {
    expect(lineAmount(item, { a: "100" }, {})).toBe(100000n);                                                         // 10 x 100.00 at 2 decimals
    const at = (p: string) => lineAmount(item, { a: "100" }, { a: [{ minQty: "10", unitPrice: p }] });
    expect(at("90")).toBe(90000n);
    expect(at("80")).toBe(80000n);
  });
  it("is null for an invalid break and for empty prices", () => {
    expect(lineAmount(item, { a: "100" }, { a: [{ minQty: "10", unitPrice: "120" }] })).toBeNull();
    expect(lineAmount(item, { a: "" }, {})).toBeNull();
  });
  it("the form recomputes totals when the breaks change (dependency lists include the tiers)", () => {
    const src = readFileSync("src/ui/BidForm.tsx", "utf8");
    const deps = [...src.matchAll(/\}\), \[([^\]]*)\]\);|\}, \[([^\]]*)\]\);/g)].map((m) => m[1] ?? m[2] ?? "");
    const totals = deps.filter((d) => /lotState|form\.lots/.test(d));
    expect(totals.length).toBeGreaterThanOrEqual(2);
    for (const d of totals) expect(d).toContain("tiers");
    expect(src).not.toMatch(/exhaustive-deps/);
  });
});
