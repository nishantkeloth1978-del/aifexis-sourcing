// Accuracy check for the bid reader on the labelled set (src/agents/reader-cases.ts), using a company's own Claude key.
// Usage: npx tsx scripts/eval-reader.ts      (it asks for the tenant id, the database connection string and the signing secret; the last two are hidden as you type)
// Prints precision, recall and F1, and every case that was missed or invented. Writes nothing to the database except the key lookup.
import { createInterface } from "node:readline";
import { getPool } from "../src/lib/db";
import { claudeFor } from "../src/assistant/models";
import { evaluateReader } from "../src/agents/readereval";

/** Asks on the terminal. With `hidden`, what you type is not shown and is kept only in this process's memory. */
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
const lines: string[] = []; let closed = false; const waiting: ((s: string) => void)[] = [];
let muted = false;
(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => { if (!muted) process.stdout.write(s); };
rl.on("line", (l) => { const w = waiting.shift(); if (w) w(l.trim()); else lines.push(l.trim()); });
rl.on("close", () => { closed = true; while (waiting.length) waiting.shift()!(""); });
function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  muted = hidden && !!process.stdin.isTTY;
  return new Promise((resolve) => {
    const done = (a: string) => { muted = false; if (hidden && process.stdin.isTTY) process.stdout.write("\n"); resolve(a); };
    const queued = lines.shift();
    if (queued !== undefined) done(queued); else if (closed) done(""); else waiting.push(done);
  });
}

async function main() {
  const tenant = process.argv[2] || await ask("Tenant id (the id from select id, name from tenant): ");
  if (!/^[0-9a-f-]{36}$/i.test(tenant)) { console.error("That does not look like a tenant id (36 characters with dashes)."); return; }
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = await ask("Database connection string (typing is hidden): ", true);
  if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL)) { console.error("The connection string must start with postgresql://"); return; }
  if (!process.env.SIGNING_SECRET) process.env.SIGNING_SECRET = await ask("Signing secret (typing is hidden): ", true);
  const pool = getPool();
  try { await pool.query("select 1"); } catch (e) { console.error(`Could not connect to the database: ${e instanceof Error ? e.message.replace(/:[^:@/]*@/, ":***@") : "unknown error"}`); await pool.end().catch(() => undefined); return; }
  const claude = await claudeFor(pool, tenant);
  if (!claude) { console.error("No Claude key is set for that company."); return; }
  const res = await evaluateReader(claude);
  for (const c of res.cases) console.log(`${c.id}: found ${c.found}/${c.gold}, extra ${c.extra}${c.failed ? " (call failed)" : ""}`);
  console.log(`\nprecision ${(res.precision * 100).toFixed(0)}%  recall ${(res.recall * 100).toFixed(0)}%  F1 ${(res.f1 * 100).toFixed(0)}%   (true ${res.tp}, extra ${res.fp}, missed ${res.fn})`);
  await pool.end();
  rl.close();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); return; });
