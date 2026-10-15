import type { Pool } from "pg";
import { audit, withTenant } from "@/authz";
import { can } from "@/access/permissions";
import type { Who } from "@/events/service";
import type { HandoverPayload } from "./service";
import { EMPTY_SAP_MAPPING, type SapMapping } from "./sap-types";
export { EMPTY_SAP_MAPPING };
export type { SapMapping };

export const SAP_NO_PERM = "Only an administrator can change the SAP mapping.";
export const SAP_BAD = "Check the SAP mapping: company code, purchasing organisation (up to 4 letters or digits), purchasing group (up to 3), plant (optional, up to 4), document type, and unit codes of up to 3 letters or digits.";
export const SAP_MESSAGES = [SAP_NO_PERM, SAP_BAD];

const CODE = (n: number) => new RegExp(`^[A-Z0-9]{1,${n}}$`);
/** Checks and cleans a mapping typed by a person. Codes are upper-cased; the unit map holds up to 40 entries. */
export function checkMapping(raw: unknown): { ok: true; value: SapMapping } | { ok: false; error: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : "");
  const m: SapMapping = { companyCode: s(o.companyCode), purchOrg: s(o.purchOrg), purchGroup: s(o.purchGroup), plant: s(o.plant), docType: s(o.docType) || "NB", uomMap: {} };
  if (!CODE(4).test(m.companyCode) || !CODE(4).test(m.purchOrg) || !CODE(3).test(m.purchGroup) || (m.plant && !CODE(4).test(m.plant)) || !CODE(4).test(m.docType)) return { ok: false, error: SAP_BAD };
  const u = o.uomMap;
  if (u && typeof u === "object" && !Array.isArray(u)) {
    const entries = Object.entries(u as Record<string, unknown>);
    if (entries.length > 40) return { ok: false, error: SAP_BAD };
    for (const [k, v] of entries) {
      const key = k.trim().toUpperCase(), val = s(v);
      if (!key || key.length > 20 || !CODE(3).test(val)) return { ok: false, error: SAP_BAD };
      m.uomMap[key] = val;
    }
  } else if (u !== undefined && u !== null) return { ok: false, error: SAP_BAD };
  return { ok: true, value: m };
}

export async function mappingOf(c: { query: (q: string) => Promise<{ rows: any[] }> }): Promise<SapMapping | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = (await c.query(`select company_code, purch_org, purch_group, coalesce(plant,'') as plant, doc_type, uom_map from erp_mapping where target = 'SAP'`)).rows[0];
  return r ? { companyCode: r.company_code, purchOrg: r.purch_org, purchGroup: r.purch_group, plant: r.plant, docType: r.doc_type, uomMap: r.uom_map } : null;
}
export const getMapping = (pool: Pool, tenantId: string) => withTenant(pool, tenantId, (c) => mappingOf(c));

export async function saveMapping(pool: Pool, who: Who, input: unknown): Promise<{ ok: true; mapping: SapMapping } | { ok: false; error: string }> {
  if (!can(who, "config.manage")) return { ok: false, error: SAP_NO_PERM };
  const v = checkMapping(input);
  if (!v.ok) return v;
  const m = v.value;
  await withTenant(pool, who.tenantId, async (c) => {
    await c.query(`insert into erp_mapping (tenant_id, target, company_code, purch_org, purch_group, plant, doc_type, uom_map, updated_by, updated_at) values ($1,'SAP',$2,$3,$4,$5,$6,$7,$8, now())
                   on conflict (tenant_id, target) do update set company_code = $2, purch_org = $3, purch_group = $4, plant = $5, doc_type = $6, uom_map = $7, updated_by = $8, updated_at = now()`,
      [who.tenantId, m.companyCode, m.purchOrg, m.purchGroup, m.plant || null, m.docType, JSON.stringify(m.uomMap), who.membershipId]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "handover.sap_mapping", { companyCode: m.companyCode, purchOrg: m.purchOrg, purchGroup: m.purchGroup, plant: m.plant, docType: m.docType, units: Object.keys(m.uomMap).length });
  });
  return { ok: true, mapping: m };
}

export interface SapItem { PurchaseOrderItem: string; Material?: string; PurchaseOrderItemText: string; Plant?: string; OrderQuantity: string; PurchaseOrderQuantityUnit: string; NetPriceAmount: string; NetPriceQuantity: "1"; DocumentCurrency: string }
export interface SapPo { PurchaseOrderType: string; CompanyCode: string; PurchasingOrganization: string; PurchasingGroup: string; Supplier: string; DocumentCurrency: string; PurchaseOrderDate: string; CorrespncExternalReference: string; to_PurchaseOrderItem: SapItem[] }
export type SapOut = { ok: true; supplier: string; document: SapPo; warnings: string[] } | { ok: false; supplier: string; errors: string[] };

const DEC = /^\d+(\.\d+)?$/;
/** The award for one supplier as an SAP purchase order (field names of the S/4HANA purchase order API). Nothing is guessed: a missing code is an error the buyer can fix. */
export function toSapPo(p: HandoverPayload, m: SapMapping | null): SapOut {
  const supplier = p.vendor.name, errors: string[] = [], warnings: string[] = [];
  if (!m) return { ok: false, supplier, errors: ["The SAP mapping has not been set up. An administrator can add it under Configuration."] };
  if (!p.vendor.vendorCode) errors.push(`${supplier} has no SAP vendor number. Add it on the supplier record.`);
  if (!p.awardedAt) errors.push("The award has no approval date.");
  if (!/^[A-Z]{3}$/.test(p.currency)) errors.push("The event currency is not a three-letter code.");
  const items: SapItem[] = [];
  for (const it of p.items) {
    const n = `Line ${it.lineNo}`;
    const unit = m.uomMap[it.unit.toUpperCase()] ?? (/^[A-Z0-9]{1,3}$/.test(it.unit.toUpperCase()) ? it.unit.toUpperCase() : "");
    if (!unit) { errors.push(`${n}: no SAP unit for "${it.unit}". Add it to the unit map.`); continue; }
    if (!DEC.test(it.quantity) || Number(it.quantity) <= 0) { errors.push(`${n}: the quantity is not a positive number.`); continue; }
    if (!DEC.test(it.unitPrice)) { errors.push(`${n}: the unit price is not a number.`); continue; }
    if (!it.materialCode) warnings.push(`${n}: no material number. SAP needs a material or a material group before the order can be saved.`);
    if (it.description.length > 40) warnings.push(`${n}: the description is shortened to 40 characters.`);
    items.push({ PurchaseOrderItem: String(it.lineNo * 10).padStart(5, "0"), ...(it.materialCode ? { Material: it.materialCode } : {}), PurchaseOrderItemText: it.description.slice(0, 40), ...(m.plant ? { Plant: m.plant } : {}),
      OrderQuantity: it.quantity, PurchaseOrderQuantityUnit: unit, NetPriceAmount: it.unitPrice, NetPriceQuantity: "1", DocumentCurrency: p.currency });
  }
  if (!items.length && !errors.length) errors.push("There are no lines to hand over.");
  if (errors.length) return { ok: false, supplier, errors };
  return { ok: true, supplier, warnings, document: { PurchaseOrderType: m.docType, CompanyCode: m.companyCode, PurchasingOrganization: m.purchOrg, PurchasingGroup: m.purchGroup, Supplier: p.vendor.vendorCode!, DocumentCurrency: p.currency,
    PurchaseOrderDate: p.awardedAt!.slice(0, 10), CorrespncExternalReference: p.eventRef.slice(0, 12), to_PurchaseOrderItem: items } };
}

const COLS = ["PO_TYPE", "COMP_CODE", "PURCH_ORG", "PUR_GROUP", "VENDOR", "CURRENCY", "DOC_DATE", "REF", "ITEM", "MATERIAL", "SHORT_TEXT", "PLANT", "QUANTITY", "UNIT", "NET_PRICE", "PRICE_UNIT"];
const cell = (v: string) => { const t = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
/** One row per purchase order item, for middleware that loads flat files. */
export function sapCsv(docs: SapPo[]): string {
  const rows = docs.flatMap((d) => d.to_PurchaseOrderItem.map((i) => [d.PurchaseOrderType, d.CompanyCode, d.PurchasingOrganization, d.PurchasingGroup, d.Supplier, d.DocumentCurrency, d.PurchaseOrderDate, d.CorrespncExternalReference,
    i.PurchaseOrderItem, i.Material ?? "", i.PurchaseOrderItemText, i.Plant ?? "", i.OrderQuantity, i.PurchaseOrderQuantityUnit, i.NetPriceAmount, i.NetPriceQuantity].map(cell).join(",")));
  return [COLS.join(","), ...rows].join("\r\n") + "\r\n";
}
