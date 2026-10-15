// Accuracy check for the bid reader on the labelled set (tests/fixtures/reader_labelled.json), using a company's own Claude key.
// Usage: npx vite-node --config vitest.config.ts scripts/eval-reader.ts <tenant-id>      (needs DATABASE_URL and SIGNING_SECRET, same values as the app)
// Prints precision, recall and F1, and every case that was missed or invented. Writes nothing to the database except the key lookup.
import { readFileSync } from "node:fs";
import { getPool } from "../src/lib/db";
import { claudeFor } from "../src/assistant/models";
import { complete } from "../src/messages/ai";
import { extractJson } from "../src/agents/harness";
import { READER_SYSTEM, checkReading, readerPrompt, scoreReader } from "../src/agents/reader";

const tenant = process.argv[2];
if (!tenant) { console.error("Give the tenant id as the first argument."); process.exit(1); }
const pool = getPool();
const claude = await claudeFor(pool, tenant);
if (!claude) { console.error("No Claude key is set for that company."); process.exit(1); }
const cases = JSON.parse(readFileSync("tests/fixtures/reader_labelled.json", "utf8")) as { id: string; text: string; gold: { kind: string; quote: string }[] }[];
const lines = [{ lineNo: 1, description: "Item as specified in the tender", quantity: "10", unit: "EA" }];
const got: { kind: string; quote: string }[][] = [];
for (const c of cases) {
  const r = await complete(READER_SYSTEM, readerPrompt("Evaluation set", lines, c.text), 2500, { claude });
  const parsed = r.ok ? checkReading(extractJson(r.text), { text: c.text, lineNos: [1] }) : null;
  got.push(parsed && parsed.ok ? parsed.value.findings.map((f) => ({ kind: f.kind, quote: f.quote })) : []);
  const s = scoreReader([c.gold], [got[got.length - 1]!]);
  console.log(`${c.id}: found ${s.tp}/${c.gold.length}, extra ${s.fp}${r.ok ? "" : " (call failed)"}`);
}
const s = scoreReader(cases.map((c) => c.gold), got);
console.log(`\nprecision ${(s.precision * 100).toFixed(0)}%  recall ${(s.recall * 100).toFixed(0)}%  F1 ${(s.f1 * 100).toFixed(0)}%   (true ${s.tp}, extra ${s.fp}, missed ${s.fn})`);
await pool.end();
