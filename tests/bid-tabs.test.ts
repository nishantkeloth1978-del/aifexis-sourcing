import { createElement } from "react";
// @ts-expect-error no types needed for the server renderer
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BidForm as Form } from "@/bids/service";

vi.mock("../app/supplier/events/[id]/actions", () => ({ discardDraftAction: vi.fn(), importPricesAction: vi.fn(), saveDraftAction: vi.fn(), submitBidAction: vi.fn() }));
const { default: BidForm } = await import("@/ui/BidForm");

const item = (n: number) => ({ id: `i${n}`, lineNo: n, description: `Line ${n}`, quantity: "2", unit: "EA", blockType: "UNIT_PRICE", lotId: null });
const ask = (key: string, envelope: "technical" | "commercial", required = true) => ({ key, label: { en: key }, type: "text", envelope, required, section: "general" });
function form(o: Partial<Omit<Form, "items">> & { items?: number; asks?: ReturnType<typeof ask>[] } = {}): Form {
  const { items: nItems, asks: askList, ...rest } = o;
  const asks = askList ?? [ask("Delivery weeks", "technical"), ask("Warranty months", "technical"), ask("Payment terms", "commercial")];
  return {
    event: { id: "e1", ref: "EV-1", title: "AV upgrade", currency: "AED", closesAt: null, state: "published", timeZone: "UTC", roundNo: 1 },
    items: Array.from({ length: nItems ?? 3 }, (_, n) => item(n + 1)), lots: [], open: true, closedReason: null, participation: "accepted", revisionNo: 0,
    prices: {}, tiers: {}, alternates: [], bundles: [], technicalText: "", total: null, gates: ["We hold a valid trade licence"], gateAnswers: {},
    envelopes: "two", questionnaire: { buyerFields: [], asks, documents: [{ key: "datasheet", label: { en: "Datasheet" }, purpose: { en: "" }, required: true, origin: "company", envelope: "technical", fileTypes: ["pdf"] }, { key: "pricebook", label: { en: "Price book" }, purpose: { en: "" }, required: false, origin: "company", envelope: "commercial", fileTypes: ["pdf"] }], sections: [{ key: "general", label: { en: "General" } }] },
    answers: {}, docFiles: {}, submittedAt: null, fingerprint: null, draft: null, laneGrid: null, laneTerms: {},
    ...rest,
  } as unknown as Form;
}
const html = (f: Form) => renderToString(createElement(BidForm, { form: f }));

describe("bid form parts", () => {
  it("shows Technical and Commercial tabs with progress when envelopes are sealed apart", () => {
    const h = html(form());
    expect(h).toContain('role="tablist"');
    expect(h).toContain("Technical");
    expect(h).toContain("Commercial");
    expect(h).toMatch(/0 of \d+ done/);
    expect(h).toContain("Technical envelope. Evaluators read this part first");
    expect(h).toContain("Delivery weeks");                     // technical field is on the first tab
    expect(h).not.toContain("Payment terms");                   // commercial field waits on its own tab
    expect(h).not.toContain("Sealed envelope. Your prices stay hidden");
  });
  it("shows one page with headed sections when all envelopes open together", () => {
    const h = html(form({ envelopes: "single" }));
    expect(h).not.toContain('role="tablist"');
    expect(h).toContain("All parts of your bid are opened together");
    expect(h).toContain("Delivery weeks"); expect(h).toContain("Payment terms"); expect(h).toContain("Prices");
    expect(h.indexOf("Delivery weeks")).toBeLessThan(h.indexOf("Payment terms"));
  });
  it("keeps a small form as it was, with no tabs and no sections", () => {
    const h = html(form({ items: 1, gates: [], asks: [ask("Delivery weeks", "technical")], questionnaire: null }));
    expect(h).not.toContain('role="tablist"'); expect(h).not.toContain("All parts of your bid");
    expect(h).toContain("1. Technical response");
  });
  it("puts documents and questions in the part they belong to", () => {
    const h = html(form({ envelopes: "single" }));
    expect(h.indexOf("Datasheet")).toBeLessThan(h.indexOf("Payment terms"));
    expect(h.indexOf("Payment terms")).toBeLessThan(h.indexOf("Price book"));
  });
  it("reports the technical part as done once everything required is answered", () => {
    const f = form({ asks: [ask("Delivery weeks", "technical")], technicalText: "We will deliver the full system.", gateAnswers: {}, answers: { "Delivery weeks": "6" }, docFiles: { datasheet: 1 } });
    // the draft state seeds the text and the gate answers
    (f as unknown as { draft: unknown }).draft = { values: { technicalText: "We will deliver the full system.", gates: { "We hold a valid trade licence": true }, prices: {}, tiers: {}, answers: { "Delivery weeks": "6" }, alternates: [], bundles: [], laneTerms: {} }, savedAt: new Date().toISOString() };
    f.items = Array.from({ length: 5 }, (_, n) => item(n + 1)) as Form["items"];
    const h = html(f);
    expect(h).toMatch(/count done[^>]*>All done/);
  });
});
