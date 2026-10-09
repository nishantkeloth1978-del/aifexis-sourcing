/** Sections of a bill of quantities: "1 Civil works" containing "1.1 Foundations". A line carries its full path, joined with " > ". */
export const SEP = " > ";
export const MAX_SECTION = 200;

/** Depth of a heading from its numbering: "1" is 1, "1.2" is 2, "1.2.3" is 3. Unnumbered headings are depth 1. */
export function headingDepth(text: string): number {
  const m = /^\s*(\d+(?:\.\d+)*)[.)]?\s/.exec(text + " ");
  return m ? m[1]!.split(".").length : 1;
}
export const cleanHeading = (text: string) => text.replace(/\s+/g, " ").trim();

/** Follows heading rows down a sheet and tells which section the next line belongs to. */
export class SectionTracker {
  private stack: { depth: number; label: string }[] = [];
  push(heading: string): string | null {
    const label = cleanHeading(heading); if (!label) return this.path();
    const depth = headingDepth(label);
    while (this.stack.length && this.stack[this.stack.length - 1]!.depth >= depth) this.stack.pop();
    this.stack.push({ depth, label });
    return this.path();
  }
  path(): string | null { return this.stack.length ? this.stack.map((s) => s.label).join(SEP).slice(0, MAX_SECTION) : null; }
  reset() { this.stack = []; }
}

export interface SectionTotal { path: string; label: string; depth: number; total: bigint; lines: number }
/** Sub-totals per section in order of first appearance; a parent includes everything inside it. Lines without a section are returned separately. */
export function rollup(lines: { section: string | null; amount: bigint }[]): { sections: SectionTotal[]; unsectioned: bigint } {
  const map = new Map<string, SectionTotal>();
  let unsectioned = 0n;
  for (const l of lines) {
    if (!l.section) { unsectioned += l.amount; continue; }
    const parts = l.section.split(SEP);
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join(SEP);
      const cur = map.get(path) ?? { path, label: parts[i - 1]!, depth: i, total: 0n, lines: 0 };
      cur.total += l.amount; cur.lines += 1; map.set(path, cur);
    }
  }
  return { sections: [...map.values()], unsectioned };
}
/** Section paths in display order for a list of lines, with the ones that start a new section flagged. */
export function headersFor(sections: (string | null)[]): { at: number; path: string; label: string; depth: number }[] {
  const out: { at: number; path: string; label: string; depth: number }[] = [];
  const seen = new Set<string>();
  sections.forEach((s, i) => {
    if (!s) return;
    const parts = s.split(SEP);
    for (let d = 1; d <= parts.length; d++) {
      const path = parts.slice(0, d).join(SEP);
      if (!seen.has(path)) { seen.add(path); out.push({ at: i, path, label: parts[d - 1]!, depth: d }); }
    }
  });
  return out;
}
