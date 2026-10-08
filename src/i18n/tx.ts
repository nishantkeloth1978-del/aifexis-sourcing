import type { Locale } from "./dict";
import { AR } from "./ar";

/**
 * Translates an English phrase. English is the key, so the code stays readable and a missing translation falls back to English.
 *  - Named values:   tx(locale, "Closes {d}", { d })        looks up "Closes {d}" and fills {d}.
 *  - Messages built at run time ("Maria has not finished scoring Acme."): add a pattern key with positional holes,
 *    "{0} has not finished scoring {1}.", and tx(locale, message) matches it and fills the holes.
 */
let compiled: { re: RegExp; to: string }[] | null = null;
function patterns() {
  if (compiled) return compiled;
  compiled = Object.entries(AR).filter(([k]) => /\{\d+\}/.test(k)).map(([k, v]) => ({
    re: new RegExp("^" + k.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\d+\}/g, "(.+?)") + "$", "s"), to: v,
  }));
  return compiled;
}
const fill = (s: string, vars?: Record<string, string | number>) => (vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? "")) : s);

export function tx(locale: Locale, en: string, vars?: Record<string, string | number>): string {
  if (locale !== "ar") return fill(en, vars);
  const hit = AR[en];
  if (hit !== undefined) return fill(hit, vars);
  const text = fill(en, vars);
  for (const p of patterns()) {
    const m = p.re.exec(text);
    if (m) return p.to.replace(/\{(\d+)\}/g, (_, i) => tx(locale, m[Number(i) + 1] ?? ""));
  }
  return text;
}
