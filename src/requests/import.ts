import type { Pool } from "pg";
import { withTenant } from "@/authz";
import type { Who } from "@/events/service";
import { createRequest, type RequestInput } from "./service";

export const IMPORT_COLUMNS = ["external_ref", "kind", "title", "description", "department", "needed_by", "est_value", "currency", "line_description", "line_quantity", "line_unit"] as const;
export const MAX_IMPORT_ROWS = 200, MAX_IMPORT_BYTES = 200_000;
export interface ImportRow { firstRow: number; title: string; ok: boolean; reference?: string; error?: string }
export interface ImportResult { ok: true; created: number; skipped: number; failed: number; rows: ImportRow[] }
export const TEMPLATE_CSV = `${IMPORT_COLUMNS.join(",")}\r\nERP-1001,goods,Safety helmets,Hard hats for the plant,Operations,2026-12-01,12000,AED,Helmet class E,200,pcs\r\nERP-1001,goods,Safety helmets,,,,,,Chin strap,200,pcs\r\nERP-1002,service,Annual crane inspection,,Maintenance,,,AED,,,\r\n`;

/** Small RFC 4180 reader: quoted cells, doubled quotes, commas or semicolons (Excel in some regions), CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const sep = (t.split(/\r?\n/, 1)[0] ?? "").split(";").length > (t.split(/\r?\n/, 1)[0] ?? "").split(",").length ? ";" : ",";
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** One request per external reference (or per title when none is given); extra lines for the same request follow it. Row by row report; nothing is half-created. */
export async function importRequestsCsv(pool: Pool, who: Who, text: string): Promise<ImportResult | { ok: false; error: string }> {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: "The file is too large (200 KB at most)." };
  const grid = parseCsv(text);
  const head = (grid[0] ?? []).map((h) => h.trim().toLowerCase());
  const miss = ["kind", "title"].filter((h) => !head.includes(h));
  if (miss.length) return { ok: false, error: "The first row must name the columns, at least kind and title. Download the template to see them." };
  if (grid.length - 1 > MAX_IMPORT_ROWS) return { ok: false, error: "Too many rows (200 at most)." };
  const at = (r: string[], k: string) => (r[head.indexOf(k)] ?? "").trim();
  const groups: { first: number; ext: string; input: RequestInput }[] = [];
  grid.slice(1).forEach((r, i) => {
    const ext = at(r, "external_ref"), title = at(r, "title");
    const g = groups[groups.length - 1];
    const line = { description: at(r, "line_description"), quantity: at(r, "line_quantity"), unit: at(r, "line_unit") };
    const hasLine = line.description || line.quantity || line.unit;
    if (g && ((ext && ext === g.ext) || (!ext && !g.ext && title === g.input.title))) { if (hasLine) g.input.lines!.push(line); return; }
    groups.push({ first: i + 2, ext, input: { kind: at(r, "kind").toLowerCase(), title, description: at(r, "description"), ownerDept: at(r, "department"), neededBy: at(r, "needed_by") || undefined, estValue: at(r, "est_value") || undefined, currency: (at(r, "currency") || "AED").toUpperCase(), lines: hasLine ? [line] : [] } });
  });
  const rows: ImportRow[] = []; let created = 0, skipped = 0, failed = 0;
  for (const g of groups) {
    if (g.ext) {
      const known = await withTenant(pool, who.tenantId, async (c) => (await c.query(`select ref from purchase_request where source = 'file' and external_ref = $1`, [g.ext.slice(0, 100)])).rows[0]?.ref as string | undefined);
      if (known) { skipped++; rows.push({ firstRow: g.first, title: g.input.title, ok: true, reference: known, error: "Already imported." }); continue; }
    }
    const r = await createRequest(pool, who, g.input, { source: "file", externalRef: g.ext ? g.ext.slice(0, 100) : null, skipDuplicateCheck: true });
    if (r.ok) { created++; rows.push({ firstRow: g.first, title: g.input.title, ok: true, reference: r.request.ref }); }
    else { failed++; rows.push({ firstRow: g.first, title: g.input.title, ok: false, error: r.error }); }
  }
  return { ok: true, created, skipped, failed, rows };
}
