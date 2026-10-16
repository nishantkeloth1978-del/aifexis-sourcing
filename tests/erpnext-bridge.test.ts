import { describe, expect, it } from "vitest";
import { awardToPo, codeOf, mrToRequest, type AwardDoc, type MaterialRequest } from "@/bridge/erpnext";

const MR: MaterialRequest = { name: "MAT-MR-2026-00001", company: "Aifexis Test", schedule_date: "2026-11-20", items: [
  { name: "row1", item_code: "SEAL-01", item_name: "Seal kit", qty: 10, uom: "Nos", warehouse: "Stores - AT", schedule_date: "2026-11-20" },
  { name: "row2", item_code: "PUMP-02", item_name: "Pump", qty: "2", uom: "Nos" }] };
const AW: AwardDoc = { vendor: { name: "Acme", vendorCode: "SUP-0001" }, currency: "AED", eventRef: "EV-2026-007", totalNet: "1300.00", items: [
  { lineNo: 1, description: "[SEAL-01] Seal kit", quantity: "10", unit: "Nos", unitPrice: "30" }, { lineNo: 2, description: "[PUMP-02] Pump", quantity: "2", unit: "Nos", unitPrice: "500" }] };

describe("ERPNext bridge mapping", () => {
  it("turns a material request into a request with item codes in the line text", () => {
    const r = mrToRequest(MR, "AED");
    expect(r).toMatchObject({ ok: true, body: { kind: "goods", externalReference: "MAT-MR-2026-00001", currency: "AED", neededBy: "2026-11-20", lines: [{ description: "[SEAL-01] Seal kit", quantity: "10", unit: "Nos" }, { description: "[PUMP-02] Pump", quantity: "2", unit: "Nos" }] } });
    expect(mrToRequest({ ...MR, items: [] }, "AED")).toMatchObject({ ok: false });
    expect(mrToRequest({ ...MR, items: [{ item_code: "X", qty: 0 }] }, "AED")).toMatchObject({ ok: false });
    expect(mrToRequest({ ...MR, schedule_date: "soon", items: [{ ...MR.items[0]!, schedule_date: undefined }] }, "AED")).toMatchObject({ ok: true, body: expect.not.objectContaining({ neededBy: expect.anything() }) });
  });
  it("builds a draft purchase order linked to the material request", () => {
    const r = awardToPo(AW, MR, "SUP-0001", "2026-10-20");
    expect(r).toMatchObject({ ok: true, po: { doctype: "Purchase Order", supplier: "SUP-0001", company: "Aifexis Test", currency: "AED", order_confirmation_no: "EV-2026-007-SUP-0001", transaction_date: "2026-10-20", schedule_date: "2026-11-20" } });
    if (r.ok) { expect(r.po.items[0]).toEqual({ item_code: "SEAL-01", qty: 10, rate: 30, uom: "Nos", schedule_date: "2026-11-20", description: "Seal kit", warehouse: "Stores - AT", material_request: "MAT-MR-2026-00001", material_request_item: "row1" }); expect(r.po.items[1]!.schedule_date).toBe("2026-11-20"); }
  });
  it("falls back to position only when the line counts match, and never guesses otherwise", () => {
    expect(codeOf("Seal kit", 0, MR, true)).toBe("SEAL-01"); expect(codeOf("Seal kit", 0, MR, false)).toBeNull();
    const plain = { ...AW, items: AW.items.map((i) => ({ ...i, description: i.description.replace(/^\[[^\]]+\] /, "") })) };
    expect(awardToPo(plain, MR, "S", "2026-10-20")).toMatchObject({ ok: true });
    expect(awardToPo({ ...plain, items: [plain.items[0]!] }, MR, "S", "2026-10-20")).toMatchObject({ ok: false });
    expect(awardToPo({ ...AW, items: [{ ...AW.items[0]!, quantity: "0" }] }, MR, "S", "2026-10-20")).toMatchObject({ ok: false });
    expect(awardToPo({ ...AW, items: [] }, MR, "S", "2026-10-20")).toMatchObject({ ok: false });
  });
});
