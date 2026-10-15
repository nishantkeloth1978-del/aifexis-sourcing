import { complete, type AiDeps } from "@/messages/ai";
import { extractJson } from "./harness";
import { READER_SYSTEM, checkReading, readerPrompt, scoreReader } from "./reader";
import { READER_CASES } from "./reader-cases";

export interface EvalCase { id: string; gold: number; found: number; extra: number; failed: boolean }
export interface EvalResult { cases: EvalCase[]; precision: number; recall: number; f1: number; tp: number; fp: number; fn: number; model: string; at: string }

const LINES = [{ lineNo: 1, description: "Item as specified in the tender", quantity: "10", unit: "EA" }];

/** Runs the reader over the labelled cases (all at once) and scores it. Uses the company's own key; writes nothing. */
export async function evaluateReader(claude: { key: string; model: string }, deps: AiDeps = {}): Promise<EvalResult> {
  const got = await Promise.all(READER_CASES.map(async (c) => {
    const r = await complete(READER_SYSTEM, readerPrompt("Evaluation set", LINES, c.text), 2500, { ...deps, claude });
    const p = r.ok ? checkReading(extractJson(r.text), { text: c.text, lineNos: [1] }) : null;
    return { failed: !r.ok || !p || !p.ok, findings: p && p.ok ? p.value.findings.map((f) => ({ kind: f.kind, quote: f.quote })) : [] };
  }));
  const cases = READER_CASES.map((c, i) => { const s = scoreReader([c.gold], [got[i]!.findings]); return { id: c.id, gold: c.gold.length, found: s.tp, extra: s.fp, failed: got[i]!.failed }; });
  const s = scoreReader(READER_CASES.map((c) => c.gold), got.map((g) => g.findings));
  return { cases, precision: s.precision, recall: s.recall, f1: s.f1, tp: s.tp, fp: s.fp, fn: s.fn, model: claude.model, at: new Date().toISOString() };
}
