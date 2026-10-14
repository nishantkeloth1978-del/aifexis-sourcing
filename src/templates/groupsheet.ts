import ExcelJS from "exceljs";
import { readTable } from "@/lib/sheetread";
import type { InputRow } from "./schedule";
import { MAX_LANES } from "./schedule";
import type { PriceGroup } from "./types";

/** An Excel sheet for filling in a repeating group (sites, roles, freight lanes) in bulk, and the reader for it. */
const FONT = { name: "Arial", size: 10 };

export async function groupTemplate(group: PriceGroup, rows: InputRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(group.label.en.slice(0, 31));
  group.inputs.forEach((inp, i) => {
    const c = ws.getCell(1, i + 1);
    c.value = inp.label.en; c.font = { ...FONT, bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: inp.required ? "FFFFF2CC" : "FFF2F2F2" } };
    ws.getColumn(i + 1).width = inp.type === "text" ? 26 : 16;
  });
  rows.forEach((r, ri) => group.inputs.forEach((inp, i) => {
    const v = r[inp.key]; if (v === undefined || v === null || v === "") return;
    ws.getCell(ri + 2, i + 1).value = inp.type === "integer" || inp.type === "decimal" ? Number(v) : String(v); ws.getCell(ri + 2, i + 1).font = FONT;
  }));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const help = wb.addWorksheet("How to fill");
  const example = group.inputs.filter((i) => i.example !== undefined).map((i) => `${i.label.en}: ${i.example}`).join("; ");
  help.addRows([
    [`${group.label.en}: one row for each entry.`],
    ["Yellow headings are required. Grey headings are optional. Keep the heading row as it is."],
    ["Whole numbers for quantities and days, no thousands separators."],
    ...(example ? [[`Example row: ${example}`]] : []),
    ...(group.asLot ? [[`Up to ${MAX_LANES} rows. Each row is priced, ranked and awarded on its own.`]] : []),
    ["After you import the file, check the rows on screen and press Save inputs."],
  ]);
  help.getColumn(1).width = 110; help.getCell("A1").font = { name: "Arial", bold: true, size: 12 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface GroupSheetResult { rows: InputRow[]; errors: { row: number; message: string }[]; total: number }

export async function parseGroupSheet(filename: string, bytes: Buffer, group: PriceGroup): Promise<GroupSheetResult | { fatal: string }> {
  const aliases: Record<string, string> = {};
  for (const inp of group.inputs) { aliases[inp.key.toLowerCase()] = inp.key; aliases[inp.label.en.trim().toLowerCase()] = inp.key; if (inp.label.ar) aliases[inp.label.ar.trim().toLowerCase()] = inp.key; }
  const required = group.inputs.filter((i) => i.required && i.default === undefined).map((i) => i.key);
  const t = await readTable<string>(filename, bytes, aliases, required.length ? required : [group.inputs[0]!.key], group.asLot ? MAX_LANES : 200);
  if ("fatal" in t) return t;
  const rows: InputRow[] = [], errors: GroupSheetResult["errors"] = [];
  for (const { row, v } of t.rows) {
    const out: InputRow = {}; let bad = false;
    for (const inp of group.inputs) {
      const raw = (v[inp.key] ?? "").trim();
      if (!raw) { if (inp.required && inp.default === undefined) { errors.push({ row, message: `Row ${row}: enter ${inp.label.en}.` }); bad = true; } continue; }
      if (inp.type === "integer" && !/^\d{1,9}$/.test(raw.replace(/\.0+$/, ""))) { errors.push({ row, message: `Row ${row}: ${inp.label.en} must be a whole number.` }); bad = true; continue; }
      if (inp.type === "decimal" && !/^\d{1,12}(\.\d{1,3})?$/.test(raw)) { errors.push({ row, message: `Row ${row}: ${inp.label.en} must be a number.` }); bad = true; continue; }
      out[inp.key] = inp.type === "integer" ? raw.replace(/\.0+$/, "") : raw.slice(0, 200);
    }
    if (!bad) rows.push(out);
  }
  return { rows, errors, total: t.rows.length };
}
