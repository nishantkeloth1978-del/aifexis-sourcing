import ExcelJS from "exceljs";
import { validateItem, type ImportRow } from "./service";
import { SectionTracker } from "@/boq/sections";

export interface SheetResult { rows: ImportRow[]; errors: { row: number; message: string }[]; total: number; unmapped: string[]; sections: number }
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
type Col = "section" | "description" | "quantity" | "unit" | "type" | "lot" | "code" | "specification" | "requiredDate" | "materialGroup" | "targetPrice";
const HEADERS: Record<string, Col> = {
  section: "section", "boq section": "section", "work package": "section", "section / group": "section",
  specification: "specification", spec: "specification", "long text": "specification", notes: "specification", remarks: "specification", "technical specification": "specification",
  "required date": "requiredDate", "delivery date": "requiredDate", "required by": "requiredDate", "need by": "requiredDate", "delivery date (requested)": "requiredDate",
  "material group": "materialGroup", "mat. group": "materialGroup", "matl group": "materialGroup", category: "materialGroup",
  "target price": "targetPrice", "estimated price": "targetPrice", "valuation price": "targetPrice", "budget price": "targetPrice",
  "short text": "description", "material description": "description", "po quantity": "quantity", "quantity requested": "quantity", "base unit of measure": "unit", "order unit": "unit", "plant material": "code", "line description": "description",
  code: "code", "item code": "code", material: "code", "material number": "code", "material no": "code", sku: "code",
  lot: "lot", "lot name": "lot", "lot no": "lot", package: "lot",
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
  const cols: Partial<Record<Col, number>> = {};
  let headerRow = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 10) && !headerRow; r++) {
    const found: typeof cols = {};
    ws.getRow(r).eachCell((cell, n) => { const k = HEADERS[cellText(cell.value).trim().toLowerCase()]; if (k && !found[k]) found[k] = n; });
    if (found.quantity && ((found.description && found.unit) || found.code)) { Object.assign(cols, found); headerRow = r; }
  }
  const unmapped: string[] = [];
  if (headerRow) ws.getRow(headerRow).eachCell((cell, n) => { const txt = cellText(cell.value).trim(); if (txt && !Object.values(cols).includes(n)) unmapped.push(txt.slice(0, 40)); });
  if (!headerRow) return { fatal: "Could not find the header row. The columns must include Quantity and either Description and Unit, or an item Code." };
  const rows: ImportRow[] = [], errors: SheetResult["errors"] = [];
  let total = 0, sections = 0;
  const tracker = new SectionTracker();
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cell = (n?: number) => (n ? norm(cellText(row.getCell(n).value)) : "");
    const d = cell(cols.description), q = cell(cols.quantity), u = cell(cols.unit), code = cell(cols.code).replace(/\s+/g, " ").toUpperCase();
    if (!d && !q && !u && !code) continue;                                                  // blank line
    if (d && !q && !u && !code) { sections++; tracker.push(d); continue; }                                  // a section heading in a nested BOQ: no quantity, unit or code
    total++;
    const t = cols.type ? norm(cellText(row.getCell(cols.type).value)).toLowerCase().replace(/[\s_-]+/g, "") : "";
    const lot = cols.lot ? norm(cellText(row.getCell(cols.lot).value)).replace(/\s+/g, " ") : "";
    if (lot.length > 120) { errors.push({ row: r, message: "The lot name is too long (120 characters at most)." }); continue; }
    if (code.length > 40) { errors.push({ row: r, message: "The item code is too long (40 characters at most)." }); continue; }
    const fromCatalog = Boolean(code) && (!d || !u);                               // description and unit come from the catalogue later
    const v = validateItem({ description: d || (fromCatalog ? "-" : ""), quantity: q, unit: u || (fromCatalog ? "-" : "") });
    if (!v.ok) { errors.push({ row: r, message: v.error }); continue; }
    if (t && !["unitprice", "lumpsum", "unit", "lump"].includes(t)) { errors.push({ row: r, message: 'Type must be "Unit price" or "Lump sum".' }); continue; }
    const extra: Partial<ImportRow> = {};
    const spec = cols.specification ? norm(cellText(row.getCell(cols.specification).value)) : "";
    const mg = cols.materialGroup ? norm(cellText(row.getCell(cols.materialGroup).value)).replace(/\s+/g, " ") : "";
    const rd = cols.requiredDate ? norm(cellText(row.getCell(cols.requiredDate).value)).slice(0, 10) : "";
    const tp = cols.targetPrice ? norm(cellText(row.getCell(cols.targetPrice).value)).replace(/,/g, "") : "";
    if (spec.length > 1000) { errors.push({ row: r, message: "The specification is too long (1,000 characters at most)." }); continue; }
    if (mg.length > 60) { errors.push({ row: r, message: "The material group is too long (60 characters at most)." }); continue; }
    if (rd && (!/^\d{4}-\d{2}-\d{2}$/.test(rd) || Number.isNaN(Date.parse(rd)))) { errors.push({ row: r, message: "Enter the required date as a valid date." }); continue; }
    if (tp && !/^\d{1,14}(\.\d{1,4})?$/.test(tp)) { errors.push({ row: r, message: "The target price must be a positive number with up to 4 decimals." }); continue; }
    const secCell = cols.section ? norm(cellText(row.getCell(cols.section).value)).replace(/\s+/g, " ") : "";
    const sec = secCell || tracker.path() || "";
    if (sec.length > 200) { errors.push({ row: r, message: "The section name is too long (200 characters at most)." }); continue; }
    if (sec) extra.section = sec;
    if (spec) extra.specification = spec; if (mg) extra.materialGroup = mg; if (rd) extra.requiredDate = rd; if (tp) extra.targetPrice = tp;
    rows.push({ ...v.value, ...extra, description: d, unit: u.toUpperCase(), blockType: t.startsWith("lump") ? "LUMP_SUM" : "UNIT_PRICE", lot: lot || undefined, code: code || undefined, rowNo: r });
  }
  if (total === 0) return { fatal: "No lines found below the header row." };
  if (total > 200) return { fatal: "The file has more than 200 lines. Split it into smaller files." };
  return { rows, errors, total, unmapped, sections };
}

export async function itemsTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Items");
  ws.columns = [{ header: "Description", key: "d", width: 60 }, { header: "Quantity", key: "q", width: 12 }, { header: "Unit", key: "u", width: 10 }, { header: "Type", key: "t", width: 16 }, { header: "Lot", key: "lot", width: 22 }, { header: "Code", key: "code", width: 16 }, { header: "Specification", key: "spec", width: 40 }, { header: "Required date", key: "rd", width: 14 }, { header: "Material group", key: "mg", width: 16 }, { header: "Target price", key: "tp", width: 12 }, { header: "Section", key: "sec", width: 28 }];
  ws.addRow({ d: "Centrifugal pump, API 610, 50 m3/h", q: 4, u: "EA", t: "Unit price", lot: "Pumps", code: "PMP-0001" });
  ws.addRow({ d: "Installation and commissioning", q: 1, u: "LS", t: "Lump sum", lot: "Services" });
  ws.getRow(1).font = { bold: true };
  const help = wb.addWorksheet("How to fill");
  help.addRows([["Fill one line per row on the Items sheet. Keep the header row."], ["Quantity: a positive number, up to 3 decimals."], ["Unit: EA, M, KG, HR, LS, ..."], ['Type (optional): "Unit price" or "Lump sum". Default is Unit price.'], ["Lot (optional): the lot a line belongs to. Leave the column empty if the event has no lots. Lines with the same lot name are grouped together."], ["Code (optional): your item code from the catalogue. If you give a code and leave Description and Unit empty, they are filled from the catalogue."], ["Specification, Required date (YYYY-MM-DD), Material group and Target price (internal only) are optional."], ["Section (optional): groups lines in a bill of quantities, for example \"1 Civil > 1.1 Foundations\". A row with only a description and a number such as \"1.2 Slabs\" starts a section for the lines below it; its depth comes from the numbering."], ["Heading rows with only a description are skipped as lines. Columns that are not recognised are ignored and listed in the preview."], ["Up to 200 lines per file."]]);
  help.getColumn(1).width = 90;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
