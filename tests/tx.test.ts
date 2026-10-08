import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AR } from "@/i18n/ar";
import { tx } from "@/i18n/tx";

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === "node_modules" || n === ".next" ? [] : walk(p)) : /\.(ts|tsx)$/.test(n) ? [p] : []; });
const files = [...walk("src"), ...walk("app")].filter((f) => !f.endsWith("i18n/tx.ts"));
const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();

describe("tx", () => {
  it("falls back to English, fills named values and matches run-time messages by pattern", () => {
    expect(tx("en", "Closes {d}", { d: "1 Jan" })).toBe("Closes 1 Jan");
    expect(tx("ar", "A phrase nobody translated")).toBe("A phrase nobody translated");
  });
  it("every translation keeps the same placeholders as its English key", () => {
    for (const [k, v] of Object.entries(AR)) { expect(v.trim().length, k).toBeGreaterThan(0); expect(ph(v), k).toBe(ph(k)); }
  });
  it("every literal passed to tx() in the code has an Arabic translation", () => {
    const re = /\btx\(\s*[A-Za-z_.]+\s*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(re)) { const lit = JSON.parse(m[1]!.startsWith("'") ? `"${m[1]!.slice(1, -1).replace(/"/g, '\\"')}"` : m[1]!) as string; if (!(lit in AR)) missing.push(`${f}: ${lit}`); }
    }
    expect(missing).toEqual([]);
  });
  it("every fixed message the services return has an Arabic translation", () => {
    const targets = files.filter((f) => /(service|workflow|commands|sheet)\.ts$/.test(f) && !f.includes("i18n"));
    const lit = /"((?:[^"\\\n]|\\.){12,}?[.?])"/g;
    const missing: string[] = [];
    for (const f of targets) for (const m of readFileSync(f, "utf8").matchAll(lit)) {
      const s = JSON.parse(`"${m[1]}"`) as string;
      if (/^[A-Z]/.test(s) && /\s/.test(s) && !(s in AR) && !Object.keys(AR).some((k) => /\{\d+\}/.test(k) && new RegExp("^" + k.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\d+\}/g, "(.+?)") + "$").test(s))) missing.push(s);
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
