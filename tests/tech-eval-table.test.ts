import { createElement } from "react";
// @ts-expect-error no types needed for the server renderer
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvalView } from "@/evaluation/service";
import TechEvalTable from "@/ui/TechEvalTable";

const CRIT = ["Experience", "Quality"];
function view(o: Partial<EvalView> = {}): EvalView {
  return {
    state: "technical_evaluation", stateVersion: 3, closesAt: null, roles: ["tech_evaluator"], isAdmin: false, bidderCount: 3, witnesses: [], decision: null,
    opening: { mode: "witnessed", envelopes: "two" }, bidders: [
      { supplierId: "a", name: "Al Noor", revisionNo: 1, technicalText: "x", gates: [], failed: ["Conflict of interest not confirmed"] },
      { supplierId: "b", name: "Bluewave", revisionNo: 1, technicalText: "y", gates: [], failed: [] },
      { supplierId: "g", name: "Gulf Freight", revisionNo: 1, technicalText: "z", gates: [], failed: [] },
    ], myScores: { b: { Experience: 9, Quality: 8 } }, results: null, criteria: CRIT, qualifyAt: 70, criterionWeights: [50, 50], declarationsRequired: false, declaration: null,
    aiAssist: true, anonymous: false, gaps: null, pendingChanges: null, canModerate: false, matrix: null,
    agent: { available: true, auto: false, override: null, ranAt: null, canRun: true, canSwitch: false },
    drafts: { b: [{ criterion: "Experience", score: 8, assessment: "meets", summary: "Twelve contracts.", quotes: ["delivered twelve similar contracts"] }, { criterion: "Quality", score: 8, assessment: "meets", summary: "", quotes: [] }] },
    ...o,
  } as EvalView;
}
const props = { locale: "en" as const, busy: false, canEdit: true, scores: { b: { Experience: "9", Quality: "8" } }, savedFor: { b: true }, why: {}, picked: {}, setScore: () => undefined, setWhy: () => undefined, onSave: () => undefined, setPicked: () => undefined };
const html = (v: EvalView, p: object = {}) => renderToString(createElement(TechEvalTable, { view: v, ...props, ...p }));

describe("technical evaluation table", () => {
  it("an evaluator gets editable score cells, one row per bidder, gates and weighted totals", () => {
    const h = html(view());
    for (const n of ["Al Noor", "Bluewave", "Gulf Freight"]) expect(h).toContain(n);
    expect(h).toContain("weight 50%");
    expect(h).toContain("Failed"); expect(h).toContain("Conflict of interest not confirmed");
    expect((h.match(/class="cellin"/g) ?? []).length).toBe(6);                 // 3 bidders x 2 criteria
    expect(h).toContain("85.0");                                               // 9 and 8 at equal weights = 85
    expect(h).toContain("Qualifies");
    expect(h).toContain("Save scores");
    expect(h).not.toContain("Evaluator comparison");                           // no matrix for an evaluator
  });
  it("an approver sees averages and the evaluator comparison, with ticks to qualify, but no editing", () => {
    const m = { b: { Experience: { avg: 8.5, by: [{ evaluator: "a@x", score: 8 }, { evaluator: "b@x", score: 9 }] }, Quality: { avg: 6, by: [{ evaluator: "a@x", score: 4 }, { evaluator: "b@x", score: 8 }] } } };
    const v = view({ roles: ["tech_approver"], matrix: m, myScores: {}, results: [{ supplierId: "b", name: "Bluewave", total: 72.5, evaluators: 2, suggested: true }, { supplierId: "g", name: "Gulf Freight", total: null, evaluators: 0, suggested: false }, { supplierId: "a", name: "Al Noor", total: null, evaluators: 0, suggested: false, disqualified: ["Conflict of interest not confirmed"] }] });
    const h = html(v, { picked: { b: true } });
    expect(h).toContain("Average of evaluators"); expect(h).toContain("Evaluator comparison");
    expect(h).not.toContain("class=\"cellin\"");
    expect(h).toContain("72.5");
    expect((h.match(/type="checkbox"/g) ?? []).length).toBe(3);
    expect(h).toContain("disabled");                                           // the disqualified bidder cannot be ticked
  });
  it("shows nothing when there is nothing to show", () => {
    expect(html(view({ bidders: null, results: null }))).toBe("");
  });
});
