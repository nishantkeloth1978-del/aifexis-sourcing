import { describe, expect, it } from "vitest";
import { priceBid } from "@/bids/service";

const items = [
  { id: "a", lineNo: 1, description: "Core", quantity: "2", unit: "ea", blockType: "UNIT_PRICE", lotId: null },
  { id: "b", lineNo: 2, description: "Extra", quantity: "1", unit: "ea", blockType: "UNIT_PRICE", lotId: null, zeroOk: true },
];
describe("per-line No bid", () => {
  it("is allowed on optional lines, adds nothing to the total and is recorded", () => {
    const r = priceBid(items, { a: "10", b: "NB" });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.total).toBe("20.00"); expect(r.lines[1]!.noBid).toBe(true); expect(r.lines[0]!.noBid).toBeUndefined(); }
  });
  it("is refused on a required line", () => {
    expect(priceBid(items, { a: "NB", b: "1" }).ok).toBe(false);
  });
});
