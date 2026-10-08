import ExcelJS from "exceljs";

export const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("result" in v && v.result != null) return String(v.result);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    return "";
  }
  return String(v);
};

/**
 * Reads the first sheet of an .xlsx or .csv. `aliases` maps lower-case header names to field names; `required` fields must all be present
 * in the header row (searched in the first 10 rows). Returns one object per non-blank row with its sheet row number.
 */
export async function readTable<F extends string>(filename: string, bytes: Buffer, aliases: Record<string, F>, required: F[], maxRows: number):
  Promise<{ rows: { row: number; v: Partial<Record<F, string>> }[] } | { fatal: string }> {
  const wb = new ExcelJS.Workbook();
  try {
    if (/\.csv$/i.test(filename)) {
      const { Readable } = await import("node:stream");
      await wb.csv.read(Readable.from(bytes.toString("utf8").replace(/^﻿/, "")));
    } else if (/\.xlsx$/i.test(filename)) await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    else return { fatal: "Use an Excel (.xlsx) or CSV file." };
  } catch { return { fatal: "That file could not be read. Check that it is a valid Excel or CSV file." }; }
  const ws = wb.worksheets[0];
  if (!ws) return { fatal: "The file has no sheet." };
  let cols: Partial<Record<F, number>> = {}, headerRow = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 10) && !headerRow; r++) {
    const found: Partial<Record<F, number>> = {};
    ws.getRow(r).eachCell((cell, n) => { const k = aliases[cellText(cell.value).trim().toLowerCase()]; if (k && !found[k]) found[k] = n; });
    if (required.every((k) => found[k])) { cols = found; headerRow = r; }
  }
  if (!headerRow) return { fatal: "Could not find the header row. Use the downloadable template." };
  const rows: { row: number; v: Partial<Record<F, string>> }[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const v: Partial<Record<F, string>> = {};
    let any = false;
    for (const [k, n] of Object.entries(cols) as [F, number][]) { const t = cellText(ws.getRow(r).getCell(n).value).trim(); v[k] = t; if (t) any = true; }
    if (any) rows.push({ row: r, v });
  }
  if (!rows.length) return { fatal: "No lines found below the header row." };
  if (rows.length > maxRows) return { fatal: `The file has more than ${maxRows} lines. Split it into smaller files.` };
  return { rows };
}
