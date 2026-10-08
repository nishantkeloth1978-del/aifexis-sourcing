import ExcelJS from "exceljs";
import { readTable } from "@/lib/sheetread";
import { MAX_SUPPLIER_IMPORT, validateProfile, type SupplierImportRow } from "./master";

type F = "name" | "contactName" | "contactEmail" | "vendorCode" | "country" | "category" | "phone" | "taxNo" | "notes";
const ALIASES: Record<string, F> = {
  name: "name", company: "name", "company name": "name", supplier: "name", "supplier name": "name", vendor: "name", "vendor name": "name",
  "contact name": "contactName", contact: "contactName", "contact email": "contactEmail", email: "contactEmail", "e-mail": "contactEmail",
  "vendor code": "vendorCode", "vendor number": "vendorCode", "supplier code": "vendorCode", "vendor no": "vendorCode", country: "country",
  category: "category", phone: "phone", telephone: "phone", "tax no": "taxNo", "tax number": "taxNo", trn: "taxNo", vat: "taxNo", notes: "notes",
};

export interface SupplierSheet { rows: SupplierImportRow[]; errors: { row: number; message: string }[]; total: number }

export async function parseSuppliersSheet(filename: string, bytes: Buffer): Promise<SupplierSheet | { fatal: string }> {
  const t = await readTable<F>(filename, bytes, ALIASES, ["name", "contactEmail"], MAX_SUPPLIER_IMPORT);
  if ("fatal" in t) return t;
  const rows: SupplierImportRow[] = [], errors: SupplierSheet["errors"] = [];
  for (const { row, v } of t.rows) {
    const x = validateProfile({ name: v.name ?? "", contactEmail: v.contactEmail ?? "", contactName: v.contactName, vendorCode: v.vendorCode, country: v.country, category: v.category, phone: v.phone, taxNo: v.taxNo, notes: v.notes });
    if (!x.ok) { errors.push({ row, message: x.error }); continue; }
    rows.push({ name: x.value.name, contactEmail: x.value.contactEmail, contactName: x.value.contactName ?? "", vendorCode: x.value.vendorCode ?? "", country: x.value.country ?? "", category: x.value.category ?? "", phone: x.value.phone ?? "", taxNo: x.value.taxNo ?? "", notes: x.value.notes ?? "" });
  }
  return { rows, errors, total: t.rows.length };
}

export async function suppliersTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Suppliers");
  ws.columns = [["Company name", 32], ["Contact email", 30], ["Contact name", 22], ["Vendor code", 14], ["Country", 14], ["Category", 20], ["Phone", 16], ["Tax number", 18], ["Notes", 30]].map(([h, w]) => ({ header: h as string, width: w as number }));
  ws.addRow(["Gulf Pumps LLC", "sales@gulfpumps.example", "Aisha Khan", "100234", "UAE", "Pumps", "+971 2 000 0000", "100200300400003", ""]);
  ws.getRow(1).font = { bold: true };
  const help = wb.addWorksheet("How to fill");
  help.addRows([["One supplier per row. Company name and Contact email are required; the rest is optional."], ["Vendor code: the supplier number in SAP or Ariba. It is passed on in the award handover."], ["Suppliers whose name or vendor code already exists are skipped."], ["Up to 500 suppliers per file."]]);
  help.getColumn(1).width = 90;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
