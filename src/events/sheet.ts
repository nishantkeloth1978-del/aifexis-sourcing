import ExcelJS from "exceljs";
import { validateItem, type ImportRow } from "./service";

export interface SheetResult { rows: ImportRow[]; errors: { row: number; message: string }[]; total: number }
const norm = (v: unknown) => String(v ?? "").trim();
const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("result" in v && v.result != null) return String(v.result);       // formula cell: use its value
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return "";
  }
  return String(v);
};
const HEADERS: Record<string, "description" | "quantity" | "unit" | "type"> = {
  description: "description", item: "description", "item description": "description", name: "description",
  quantity: "quantity", qty: "quantity", unit: "unit", uom: "unit", "unit of measure": "unit", type: "type", "pricing type": "type",
};

/** Reads the first sheet of an .xlsx or .csv: a header row (Description, Quantity, Unit, optional Type) and one line per row. */
export async function parseItemsSheet(filename: string, bytes: Buffer): Promise<SheetResult | { fatal: string }> {
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
  const cols: Partial<Record<"description" | "quantity" | "unit" | "type", number>> = {};
  let headerRow = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 10) && !headerRow; r++) {
    const found: typeof cols = {};
    ws.getRow(r).eachCell((cell, n) => { const k = HEADERS[cellText(cell.value).trim().toLowerCase()]; if (k && !found[k]) found[k] = n; });
    if (found.description && found.quantity && found.unit) { Object.assign(cols, found); headerRow = r; }
  }
  if (!headerRow) return { fatal: "Could not find the header row. The first columns must be Description, Quantity and Unit." };
  const rows: ImportRow[] = [], errors: SheetResult["errors"] = [];
  let total = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const d = norm(cellText(row.getCell(cols.description!).value)), q = norm(cellText(row.getCell(cols.quantity!).value)), u = norm(cellText(row.getCell(cols.unit!).value));
    if (!d && !q && !u) continue;                                                  // blank line
    total++;
    const t = cols.type ? norm(cellText(row.getCell(cols.type).value)).toLowerCase().replace(/[\s_-]+/g, "") : "";
    const v = validateItem({ description: d, quantity: q, unit: u });
    if (!v.ok) { errors.push({ row: r, message: v.error }); continue; }
    if (t && !["unitprice", "lumpsum", "unit", "lump"].includes(t)) { errors.push({ row: r, message: 'Type must be "Unit price" or "Lump sum".' }); continue; }
    rows.push({ ...v.value, unit: v.value.unit.toUpperCase(), blockType: t.startsWith("lump") ? "LUMP_SUM" : "UNIT_PRICE" });
  }
  if (total === 0) return { fatal: "No lines found below the header row." };
  if (total > 200) return { fatal: "The file has more than 200 lines. Split it into smaller files." };
  return { rows, errors, total };
}

export async function itemsTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Items");
  ws.columns = [{ header: "Description", key: "d", width: 60 }, { header: "Quantity", key: "q", width: 12 }, { header: "Unit", key: "u", width: 10 }, { header: "Type", key: "t", width: 16 }];
  ws.addRow({ d: "Centrifugal pump, API 610, 50 m3/h", q: 4, u: "EA", t: "Unit price" });
  ws.addRow({ d: "Installation and commissioning", q: 1, u: "LS", t: "Lump sum" });
  ws.getRow(1).font = { bold: true };
  const help = wb.addWorksheet("How to fill");
  help.addRows([["Fill one line per row on the Items sheet. Keep the header row."], ["Quantity: a positive number, up to 3 decimals."], ["Unit: EA, M, KG, HR, LS, ..."], ['Type (optional): "Unit price" or "Lump sum". Default is Unit price.'], ["Up to 200 lines per file."]]);
  help.getColumn(1).width = 90;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
