import { describe, expect, it } from "vitest";
import { SectionTracker, headersFor, headingDepth, rollup } from "@/boq/sections";
import { applyTiers } from "@/boq/tiers";

describe("sections", () => {
  it("reads depth from numbering and builds paths", () => {
    expect(headingDepth("1 Civil works")).toBe(1);
    expect(headingDepth("1.2 Foundations")).toBe(2);
    expect(headingDepth("2.1.3. Slabs")).toBe(3);
    expect(headingDepth("Mechanical")).toBe(1);
    const t = new SectionTracker();
    expect(t.push("1 Civil")).toBe("1 Civil");
    expect(t.push("1.1 Foundations")).toBe("1 Civil > 1.1 Foundations");
    expect(t.push("1.2 Slabs")).toBe("1 Civil > 1.2 Slabs");
    expect(t.push("2 Mechanical")).toBe("2 Mechanical");
    expect(t.push("Piping")).toBe("Piping");               // unnumbered: depth 1, replaces the stack
    t.reset(); expect(t.path()).toBeNull();
  });
  it("rolls totals up into parents", () => {
    const r = rollup([
      { section: "1 Civil > 1.1 Foundations", amount: 1000n }, { section: "1 Civil > 1.1 Foundations", amount: 500n },
      { section: "1 Civil > 1.2 Slabs", amount: 200n }, { section: "2 Mech", amount: 50n }, { section: null, amount: 7n },
    ]);
    expect(r.sections.map((s) => [s.path, s.total, s.lines])).toEqual([["1 Civil", 1700n, 3], ["1 Civil > 1.1 Foundations", 1500n, 2], ["1 Civil > 1.2 Slabs", 200n, 1], ["2 Mech", 50n, 1]]);
    expect(r.unsectioned).toBe(7n);
  });
  it("lists a header where each section starts", () => {
    expect(headersFor([null, "A > B", "A > B", "A > C", "D"]).map((h) => [h.at, h.path, h.depth])).toEqual([[1, "A", 1], [1, "A > B", 2], [3, "A > C", 2], [4, "D", 1]]);
  });
});

describe("price breaks", () => {
  it("picks the break that applies at the quantity", () => {
    const tiers = [{ minQty: "100", unitPrice: "9" }, { minQty: "50", unitPrice: "9.5" }];
    const at = (q: string) => { const r = applyTiers("10", tiers, q, 1); if (!r.ok) throw new Error(r.error); return r; };
    expect(at("10").effective).toBe(100000n);
    expect(at("50").effective).toBe(95000n);
    expect(at("99.999").effective).toBe(95000n);
    expect(at("100").effective).toBe(90000n);
    expect(at("100").applied).toEqual({ minQty: "100", unitPrice: "9" });
    expect(at("100").tiers.map((t) => t.minQty)).toEqual(["50", "100"]);   // sorted
  });
  it("rejects breaks that are not cheaper, duplicated or malformed", () => {
    expect(applyTiers("10", [{ minQty: "50", unitPrice: "10" }], "100", 3)).toMatchObject({ ok: false });
    expect(applyTiers("10", [{ minQty: "50", unitPrice: "9" }, { minQty: "50", unitPrice: "8" }], "100", 3)).toMatchObject({ ok: false });
    expect(applyTiers("10", [{ minQty: "0", unitPrice: "9" }], "100", 3)).toMatchObject({ ok: false });
    expect(applyTiers("10", [{ minQty: "5", unitPrice: "" }], "100", 3)).toMatchObject({ ok: false });
    expect(applyTiers("10", Array.from({ length: 5 }, (_, i) => ({ minQty: String(i + 1), unitPrice: String(9 - i) })), "100", 3)).toMatchObject({ ok: false });
    expect(applyTiers("x", [], "1", 3)).toMatchObject({ ok: false });
    expect(applyTiers("10", [{ minQty: "", unitPrice: "" }], "5", 3)).toMatchObject({ ok: true });   // empty rows are ignored
  });
});
