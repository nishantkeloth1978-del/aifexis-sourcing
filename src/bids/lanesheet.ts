import ExcelJS from "exceljs";
import { parseDec } from "@/engine";
import type { BidForm } from "./service";
import type { LaneCol, LaneGrid, LaneTerms } from "./lanes";

const YELLOW = "FFFFF2CC", GREY = "FFF2F2F2", BLUE = "FFE8F0FC", HEAD = "FFD9DEE5";
const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v && v.result != null) return v.result instanceof Date ? v.result.toISOString().slice(0, 10) : String(v.result);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    return "";
  }
  return String(v);
};
const colLetter = (n: number) => { let s = ""; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

interface Layout { head: { key: string; text: string; kind: "no" | "name" | "buyer" | "qty" | "comp" | "allin" | "annual" | "answer" | "meets"; col?: LaneCol; compKey?: string }[] }
function layoutOf(grid: LaneGrid, cur: string): Layout {
  const c = cur || "currency";
  const head: Layout["head"] = [{ key: "no", text: "Lane", kind: "no" }, { key: "name", text: "Route", kind: "name" }];
  for (const b of grid.buyerCols) head.push({ key: b.key, text: b.label.en, kind: "buyer", col: b });
  if (!grid.quantityKey) head.push({ key: "qty", text: "Quantity", kind: "qty" });
  for (const k of grid.components) head.push({ key: k.lineKey, text: `${k.label.en} (${c})`, kind: "comp", compKey: k.lineKey });
  head.push({ key: "allin", text: `All-in price (${c})`, kind: "allin" }, { key: "annual", text: `Annual cost (${c})`, kind: "annual" });
  for (const a of grid.answers) head.push({ key: a.key, text: a.label.en, kind: "answer", col: a });
  if (grid.limit) head.push({ key: "meets", text: "Meets limit?", kind: "meets" });
  return { head };
}

/** The sheet a supplier downloads for a lane tender: one row per lane, the buyer's columns fixed, the supplier's columns yellow. */
export async function laneSheet(form: BidForm): Promise<Buffer> {
  const grid = form.laneGrid!;
  const cur = form.event.currency;
  const { head } = layoutOf(grid, cur);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Lane prices", { views: [{ state: "frozen", xSplit: 2, ySplit: 5 }] });
  const font = { name: "Arial", size: 10 };
  ws.getCell("A1").value = `${form.event.ref}: ${form.event.title}`; ws.getCell("A1").font = { name: "Arial", size: 13, bold: true };
  ws.getCell("A2").value = `Prices are ${cur || "in the event currency"} per unit (for example per container). Fill the yellow cells. Do not change the grey cells or the Lane numbers.`; ws.getCell("A2").font = font;
  ws.getCell("A3").value = "Grey: fixed by the buyer. Yellow: you fill in. Blue: calculated. Enter 0 for a charge that is included in another price. Leave a whole lane empty if you do not bid on it."; ws.getCell("A3").font = font;
  const hr = 5;
  head.forEach((h, i) => {
    const c = ws.getCell(hr, i + 1);
    c.value = h.text; c.font = { ...font, bold: true }; c.alignment = { wrapText: true, vertical: "middle" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: h.kind === "comp" || h.kind === "answer" ? YELLOW : h.kind === "allin" || h.kind === "annual" || h.kind === "meets" ? BLUE : HEAD } };
    ws.getColumn(i + 1).width = h.kind === "name" ? 34 : h.kind === "buyer" ? (h.col!.type === "text" ? 16 : 13) : h.kind === "no" ? 7 : 16;
  });
  ws.getRow(hr).height = 42;
  const at = (kind: string, key?: string) => head.findIndex((h) => h.kind === kind && (key === undefined || h.key === key)) + 1;
  const first = at("comp"), last = first + grid.components.length - 1;
  const qtyCol = grid.quantityKey ? at("buyer", grid.quantityKey) : at("qty");
  grid.lanes.forEach((lane, li) => {
    const r = hr + 1 + li;
    const terms = form.laneTerms[lane.key] ?? {};
    head.forEach((h, i) => {
      const c = ws.getCell(r, i + 1); c.font = font;
      const L = colLetter(i + 1);
      if (h.kind === "no") { c.value = lane.no; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } }; }
      else if (h.kind === "name") { c.value = lane.name; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } }; }
      else if (h.kind === "buyer") { const raw = lane.buyer[h.key] ?? ""; c.value = h.col!.type === "integer" || h.col!.type === "decimal" ? (raw === "" ? null : Number(raw)) : raw; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } }; }
      else if (h.kind === "qty") { c.value = Number(lane.quantity); c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } }; }
      else if (h.kind === "comp") {
        const id = lane.items[h.compKey!]; const p = id ? form.prices[id] : undefined;
        c.value = p === undefined || p === "" ? null : p === "NB" ? 0 : Number(p);
        c.numFmt = "#,##0.00"; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
        c.dataValidation = { type: "decimal", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: "Price", error: "Enter a number, 0 or more." };
      } else if (h.kind === "allin") {
        const rng = `${colLetter(first)}${r}:${colLetter(last)}${r}`;
        c.value = { formula: `IF(COUNT(${rng})=0,"",SUM(${rng}))` }; c.numFmt = "#,##0.00"; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } }; c.font = { ...font, bold: true };
      } else if (h.kind === "annual") {
        c.value = { formula: `IF(${colLetter(at("allin"))}${r}="","",${colLetter(at("allin"))}${r}*${colLetter(qtyCol)}${r})` }; c.numFmt = "#,##0"; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
      } else if (h.kind === "answer") {
        const v = terms[h.key] ?? "";
        c.value = h.col!.type === "integer" || h.col!.type === "decimal" ? (v === "" ? null : Number(v)) : h.col!.type === "date" ? (v ? new Date(`${v}T00:00:00Z`) : null) : v;
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
        if (h.col!.type === "date") { c.numFmt = "yyyy-mm-dd"; c.dataValidation = { type: "date", operator: "greaterThan", allowBlank: true, formulae: [new Date("2000-01-01T00:00:00Z")], showErrorMessage: true, errorTitle: "Date", error: "Enter a date, for example 2027-12-31." }; }
        else if (h.col!.type === "integer") c.dataValidation = { type: "whole", operator: "between", allowBlank: true, formulae: [0, 9999], showErrorMessage: true, errorTitle: "Number", error: "Enter a whole number." };
      } else if (h.kind === "meets" && grid.limit) {
        const max = at("buyer", grid.limit.max), got = at("answer", grid.limit.answer);
        c.value = { formula: `IF(OR(${colLetter(got)}${r}="",${colLetter(max)}${r}=""),"",IF(${colLetter(got)}${r}<=${colLetter(max)}${r},"Yes","No"))` }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
      }
      void L;
    });
  });
  const help = wb.addWorksheet("How to fill");
  help.addRows([
    [`${form.event.ref}: ${form.event.title}`],
    ["One row per lane. Fill the yellow price cells and the yellow lane facts (for example transit time, sailings and free days)."],
    ["The All-in price adds up your price columns. Enter 0 for a charge that is included in another price."],
    ["If you do not bid on a lane, leave all of its yellow cells empty. If you bid on a lane, price every column of it."],
    ["Do not change the Lane numbers or add rows. Upload the file on the bid page, check the prices on screen, then submit."],
    ["Prices: zero or more, up to 4 decimals. Dates as year-month-day, for example 2027-12-31."],
  ]);
  help.getColumn(1).width = 110; help.getCell("A1").font = { name: "Arial", bold: true, size: 12 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface LaneSheetResult { prices: Record<string, string>; terms: LaneTerms; errors: { row: number; message: string }[]; filled: number }

const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
function dateOf(raw: string): string | null {
  let s = raw.trim();
  const m = dmy.exec(s); if (m) s = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  s = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s ? s : null;
}

/** Reads a filled lane sheet. Lanes are matched by lane number; blank cells are left as they were. */
export async function parseLaneSheet(filename: string, bytes: Buffer, form: BidForm): Promise<LaneSheetResult | { fatal: string }> {
  const grid = form.laneGrid;
  if (!grid) return { fatal: "This event is not priced by lane." };
  if (!/\.xlsx$/i.test(filename)) return { fatal: "Use the Excel (.xlsx) lane sheet you downloaded." };
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(bytes as unknown as ArrayBuffer); } catch { return { fatal: "That file could not be read. Check that it is a valid Excel file." }; }
  const ws = wb.worksheets[0];
  if (!ws) return { fatal: "The file has no sheet." };
  const { head } = layoutOf(grid, form.event.currency);
  let hr = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 15) && !hr; r++) if (norm(cellText(ws.getRow(r).getCell(1).value)) === "lane") hr = r;
  if (!hr) return { fatal: "Could not find the Lane column. Use the sheet you downloaded." };
  const colOf = new Map<string, number>();
  ws.getRow(hr).eachCell((cell, n) => { const t = norm(cellText(cell.value)); if (t) colOf.set(t, n); });
  const need = head.filter((h) => h.kind === "comp" || h.kind === "answer");
  for (const h of need) if (!colOf.has(norm(h.text))) return { fatal: `Could not find the column "${h.text}". Use the sheet you downloaded.` };
  const prices: Record<string, string> = {}, terms: LaneTerms = {}, errors: LaneSheetResult["errors"] = [];
  let filled = 0;
  for (let r = hr + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const ln = cellText(row.getCell(colOf.get("lane")!).value).trim();
    if (!ln) continue;
    const lane = /^\d+$/.test(ln) ? grid.lanes.find((l) => l.no === Number(ln)) : undefined;
    if (!lane) { errors.push({ row: r, message: `Lane "${ln}" is not on this event.` }); continue; }
    for (const comp of grid.components) {
      const raw = cellText(row.getCell(colOf.get(norm(`${comp.label.en} (${form.event.currency || "currency"})`))!).value).trim();
      if (!raw) continue;
      const p = parseDec(raw, 4);
      if (p === null || p < 0n || (p === 0n && !comp.zeroOk)) { errors.push({ row: r, message: `Lane ${lane.no}: ${comp.label.en} must be ${comp.zeroOk ? "0 or more" : "greater than zero"} (up to 4 decimals).` }); continue; }
      prices[lane.items[comp.lineKey]!] = raw; filled++;
    }
    for (const a of grid.answers) {
      const raw = cellText(row.getCell(colOf.get(norm(a.label.en))!).value).trim();
      if (!raw) continue;
      let v: string | null = raw;
      if (a.type === "integer") v = /^\d{1,4}$/.test(raw.replace(/\.0+$/, "")) ? raw.replace(/\.0+$/, "") : null;
      else if (a.type === "decimal") v = /^\d{1,9}(\.\d{1,4})?$/.test(raw) ? raw : null;
      else if (a.type === "date") v = dateOf(raw);
      if (v === null) { errors.push({ row: r, message: `Lane ${lane.no}: check ${a.label.en}.` }); continue; }
      terms[lane.key] = { ...(terms[lane.key] ?? {}), [a.key]: v };
    }
  }
  return { prices, terms, errors, filled };
}
