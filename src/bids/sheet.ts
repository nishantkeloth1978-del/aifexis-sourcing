import ExcelJS from "exceljs";
import { parseDec } from "@/engine";
import type { BidForm } from "./service";

const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("result" in v && v.result != null) return String(v.result);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    return "";
  }
  return String(v);
};

/** The price sheet a supplier downloads: one row per line, with their current price filled in. */
export async function priceSheet(form: BidForm): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Prices");
  const lotName = new Map(form.lots.map((l) => [l.id, `${l.lotNo}. ${l.name}`]));
  ws.columns = [{ header: "Line", key: "l", width: 7 }, ...(form.lots.length ? [{ header: "Lot", key: "lot", width: 24 }] : []), { header: "Description", key: "d", width: 60 }, { header: "Quantity", key: "q", width: 12 }, { header: "Unit", key: "u", width: 8 },
    { header: "Pricing", key: "p", width: 12 }, { header: `Unit price (${form.event.currency || "currency"})`, key: "x", width: 18 }];
  for (const it of form.items) {
    const r = ws.addRow({ l: it.lineNo, lot: it.lotId ? lotName.get(it.lotId) ?? "" : "", d: it.description, q: Number(it.quantity), u: it.unit, p: it.blockType === "LUMP_SUM" ? "Lump sum" : "Unit price", x: form.prices[it.id] ? Number(form.prices[it.id]) : null });
    r.getCell("x").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  }
  ws.getRow(1).font = { bold: true };
  const help = wb.addWorksheet("How to fill");
  help.addRows([[`${form.event.ref}: ${form.event.title}`], ["Enter your price in the yellow column. Do not change the Line numbers."], ["For a lump-sum line, enter the total for that line."], ...(form.lots.length ? [["This event has lots. Price every line of a lot, or leave the whole lot empty if you do not bid on it."]] : []), ["Prices: greater than zero, up to 4 decimals."], ["Upload the file on the bid page, check the prices, then submit."]]);
  help.getColumn(1).width = 90;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface PriceSheetResult { prices: Record<string, string>; errors: { row: number; message: string }[]; filled: number }

/** Reads a filled sheet. Lines are matched by line number; blank prices are left as they were. */
export async function parsePriceSheet(filename: string, bytes: Buffer, items: BidForm["items"]): Promise<PriceSheetResult | { fatal: string }> {
  if (!/\.xlsx$/i.test(filename)) return { fatal: "Use the Excel (.xlsx) price sheet you downloaded." };
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(bytes as unknown as ArrayBuffer); } catch { return { fatal: "That file could not be read. Check that it is a valid Excel file." }; }
  const ws = wb.worksheets[0];
  if (!ws) return { fatal: "The file has no sheet." };
  let lineCol = 0, priceCol = 0, headerRow = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 10) && !headerRow; r++) {
    let l = 0, p = 0;
    ws.getRow(r).eachCell((cell, n) => { const t = cellText(cell.value).trim().toLowerCase(); if (t === "line" || t === "line no" || t === "#") l = n; if (t === "price" || t.startsWith("unit price")) p = n; });
    if (l && p) { lineCol = l; priceCol = p; headerRow = r; }
  }
  if (!headerRow) return { fatal: "Could not find the Line and Unit price columns. Use the sheet you downloaded." };
  const byLine = new Map(items.map((i) => [i.lineNo, i]));
  const prices: Record<string, string> = {}, errors: PriceSheetResult["errors"] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const ln = cellText(row.getCell(lineCol).value).trim(), raw = cellText(row.getCell(priceCol).value).trim();
    if (!ln && !raw) continue;
    const item = /^\d+$/.test(ln) ? byLine.get(Number(ln)) : undefined;
    if (!item) { errors.push({ row: r, message: `Line "${ln}" is not on this event.` }); continue; }
    if (!raw) continue;
    const p = parseDec(raw, 4);
    if (p === null || p <= 0n) { errors.push({ row: r, message: `Line ${ln}: enter a price greater than zero (up to 4 decimals).` }); continue; }
    prices[item.id] = raw;
  }
  return { prices, errors, filled: Object.keys(prices).length };
}
