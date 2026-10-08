import ExcelJS from "exceljs";
import { readTable } from "@/lib/sheetread";
import { validateCatalog, MAX_CATALOG_IMPORT, type CatalogInput } from "./service";

type F = "code" | "description" | "unit" | "category";
const ALIASES: Record<string, F> = {
  code: "code", "item code": "code", "material": "code", "material number": "code", "material no": "code", sku: "code",
  description: "description", item: "description", "item description": "description", name: "description",
  unit: "unit", uom: "unit", "unit of measure": "unit", category: "category", group: "category", "material group": "category",
};

export interface CatalogSheet { rows: CatalogInput[]; errors: { row: number; message: string }[]; total: number }

export async function parseCatalogSheet(filename: string, bytes: Buffer): Promise<CatalogSheet | { fatal: string }> {
  const t = await readTable<F>(filename, bytes, ALIASES, ["code", "description", "unit"], MAX_CATALOG_IMPORT);
  if ("fatal" in t) return t;
  const rows: CatalogInput[] = [], errors: CatalogSheet["errors"] = [], seen = new Set<string>();
  for (const { row, v } of t.rows) {
    const x = validateCatalog({ code: v.code ?? "", description: v.description ?? "", unit: v.unit ?? "", category: v.category });
    if (!x.ok) { errors.push({ row, message: x.error }); continue; }
    if (seen.has(x.value.code)) { errors.push({ row, message: "This code appears twice in the file." }); continue; }
    seen.add(x.value.code); rows.push({ ...x.value, category: x.value.category ?? "" });
  }
  return { rows, errors, total: t.rows.length };
}

export async function catalogTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Catalogue");
  ws.columns = [{ header: "Code", key: "c", width: 18 }, { header: "Description", key: "d", width: 60 }, { header: "Unit", key: "u", width: 10 }, { header: "Category", key: "g", width: 24 }];
  ws.addRow({ c: "PMP-0001", d: "Centrifugal pump, API 610, 50 m3/h", u: "EA", g: "Pumps" });
  ws.addRow({ c: "SRV-0010", d: "Installation and commissioning", u: "LS", g: "Services" });
  ws.getRow(1).font = { bold: true };
  const help = wb.addWorksheet("How to fill");
  help.addRows([["One item per row. Keep the header row."], ["Code: your material or service number. A code that already exists is updated."], ["Unit: EA, M, KG, HR, LS, ..."], ["Category (optional): used for searching."], ["Up to 1,000 items per file."]]);
  help.getColumn(1).width = 90;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
