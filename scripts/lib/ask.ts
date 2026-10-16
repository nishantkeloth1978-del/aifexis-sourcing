import { createInterface } from "node:readline";
// Asks on the terminal. With `hidden`, what you type is not shown and is kept only in this process's memory.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
const lines: string[] = []; let closed = false; const waiting: ((s: string) => void)[] = [];
let muted = false;
(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => { if (!muted) process.stdout.write(s); };
rl.on("line", (l) => { const w = waiting.shift(); if (w) w(l.trim()); else lines.push(l.trim()); });
rl.on("close", () => { closed = true; while (waiting.length) waiting.shift()!(""); });
export function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  muted = hidden && !!process.stdin.isTTY;
  return new Promise((resolve) => {
    const done = (a: string) => { muted = false; if (hidden && process.stdin.isTTY) process.stdout.write("\n"); resolve(a); };
    const queued = lines.shift();
    if (queued !== undefined) done(queued); else if (closed) done(""); else waiting.push(done);
  });
}
export const closeAsk = () => rl.close();
