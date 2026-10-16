/** Pure mapping between ERPNext documents and the Aifexis integration API. No network and no secrets here (the script in scripts/erpnext-bridge.ts does the calls). */
export interface MrItem { name?: string; item_code: string; item_name?: string; description?: string; qty: number | string; uom?: string; schedule_date?: string; warehouse?: string; item_group?: string; amount?: number | string; rate?: number | string }
export interface MaterialRequest { name: string; material_request_type?: string; company?: string; schedule_date?: string; transaction_date?: string; items: MrItem[] }
export interface AwardDoc { vendor: { name: string; vendorCode?: string }; currency: string; eventRef: string; items: { lineNo: number; description: string; quantity: string; unit: string; unitPrice: string }[]; totalNet: string }

const CODE = /^\[([^\]\r\n]{1,140})\]\s*/;
const clean = (s: string) => s.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
const num = (v: number | string) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? String(n) : null; };

/** A Material Request as a request for POST /api/v1/requests. The ERPNext item code travels in front of the description as [CODE] because event lines carry no item code. */
export function mrToRequest(mr: MaterialRequest, currency: string): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  if (!mr.items?.length) return { ok: false, error: `${mr.name}: no items.` };
  const lines: { description: string; quantity: string; unit: string; materialGroup?: string }[] = [];
  let estimate = 0;
  for (const it of mr.items) {
    const q = num(it.qty);
    if (!q) return { ok: false, error: `${mr.name}: item ${it.item_code} has no positive quantity.` };
    const text = clean(it.item_name || it.description || it.item_code);
    lines.push({ description: `[${clean(it.item_code)}] ${text}`.slice(0, 500), quantity: q, unit: clean(it.uom || "Nos").slice(0, 20), ...(it.item_group ? { materialGroup: clean(it.item_group).slice(0, 60) } : {}) });
    const amt = Number(it.amount ?? Number(it.rate ?? 0) * Number(q)); if (Number.isFinite(amt) && amt > 0) estimate += amt;
  }
  const needed = (mr.schedule_date || mr.items[0]?.schedule_date || "").slice(0, 10);
  return { ok: true, body: { kind: "goods", title: `Material Request ${mr.name}`.slice(0, 200), description: `Raised in ERPNext as ${mr.name}.`, externalReference: mr.name, currency, ...(estimate > 0 ? { estimatedValue: estimate.toFixed(2) } : {}), ...(/^\d{4}-\d{2}-\d{2}$/.test(needed) ? { neededBy: needed } : {}), lines } };
}

export interface PoItem { item_code: string; qty: number; rate: number; uom: string; schedule_date: string; description: string; warehouse?: string; material_request?: string; material_request_item?: string }
export interface PoDoc { doctype: "Purchase Order"; supplier: string; company?: string; transaction_date: string; schedule_date: string; currency: string; order_confirmation_no: string; items: PoItem[] }

/** The item code for an award line: the [CODE] prefix, else the same position in the Material Request (only when the line counts match). */
export function codeOf(description: string, index: number, mr: MaterialRequest, same: boolean): string | null {
  const m = CODE.exec(description);
  if (m) return m[1]!.trim();
  return same ? mr.items[index]?.item_code ?? null : null;
}

/** One award document as a draft ERPNext Purchase Order. `supplier` is the ERPNext Supplier name found for this vendor. Every line must resolve to an item code, or nothing is built. */
export function awardToPo(a: AwardDoc, mr: MaterialRequest, supplier: string, today: string): { ok: true; po: PoDoc } | { ok: false; errors: string[] } {
  const errors: string[] = [], items: PoItem[] = [];
  const same = a.items.length === mr.items.length;
  const fallbackDate = new Date(Date.parse(today) + 14 * 86400_000).toISOString().slice(0, 10);
  for (const [i, it] of a.items.entries()) {
    const code = codeOf(it.description, i, mr, same);
    const qty = Number(it.quantity), rate = Number(it.unitPrice);
    if (!code) { errors.push(`Line ${it.lineNo}: no ERPNext item code ([CODE] prefix missing from the description).`); continue; }
    if (!(qty > 0) || !Number.isFinite(rate) || rate < 0) { errors.push(`Line ${it.lineNo}: quantity or price is not a number.`); continue; }
    const src = mr.items.find((x) => x.item_code === code);
    items.push({ item_code: code, qty, rate, uom: it.unit, schedule_date: (src?.schedule_date || mr.schedule_date || fallbackDate).slice(0, 10), description: clean(it.description.replace(CODE, "")).slice(0, 300),
      ...(src?.warehouse ? { warehouse: src.warehouse } : {}), material_request: mr.name, ...(src?.name ? { material_request_item: src.name } : {}) });
  }
  if (!items.length && !errors.length) errors.push("The award has no lines.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, po: { doctype: "Purchase Order", supplier, ...(mr.company ? { company: mr.company } : {}), transaction_date: today, schedule_date: items[0]!.schedule_date, currency: a.currency,
    order_confirmation_no: `${a.eventRef}-${a.vendor.vendorCode || a.vendor.name}`.slice(0, 140), items } };
}
