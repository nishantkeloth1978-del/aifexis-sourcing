import type { Pool } from "pg";
import { audit, withTenant } from "@/authz";
import { can } from "@/access/permissions";
import type { Who } from "@/events/service";
import type { HandoverPayload } from "./service";
import type { AribaMapping } from "./ariba-types";
export type { AribaMapping };

export const AR_NO_PERM = "Only an administrator can change the Ariba mapping.";
export const AR_BAD = "Check the Ariba mapping: the buyer's Ariba Network ID (3 to 40 letters, digits or . _ -), the buyer name, and unit codes of 1 to 3 letters or digits.";
export const ARIBA_MESSAGES = [AR_NO_PERM, AR_BAD];

/** Checks and cleans a mapping typed by a person. Unit codes are upper-cased; the unit map holds up to 40 entries. */
export function checkAribaMapping(raw: unknown): { ok: true; value: AribaMapping } | { ok: false; error: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const t = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim() : "");
  const m: AribaMapping = { buyerNetworkId: t(o.buyerNetworkId), buyerName: t(o.buyerName), shipToName: t(o.shipToName), testMode: o.testMode !== false, uomMap: {} };
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(m.buyerNetworkId) || m.buyerName.length < 2 || m.buyerName.length > 100 || (m.shipToName && (m.shipToName.length < 2 || m.shipToName.length > 100))) return { ok: false, error: AR_BAD };
  const u = o.uomMap;
  if (u && typeof u === "object" && !Array.isArray(u)) {
    const entries = Object.entries(u as Record<string, unknown>);
    if (entries.length > 40) return { ok: false, error: AR_BAD };
    for (const [k, v] of entries) {
      const key = k.trim().toUpperCase(), val = t(v).toUpperCase();
      if (!key || key.length > 20 || !/^[A-Z0-9]{1,3}$/.test(val)) return { ok: false, error: AR_BAD };
      m.uomMap[key] = val;
    }
  } else if (u !== undefined && u !== null) return { ok: false, error: AR_BAD };
  return { ok: true, value: m };
}

export async function aribaMappingOf(c: { query: (q: string) => Promise<{ rows: any[] }> }): Promise<AribaMapping | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = (await c.query(`select buyer_network_id, buyer_name, coalesce(ship_to_name,'') as ship_to_name, test_mode, uom_map from ariba_mapping`)).rows[0];
  return r ? { buyerNetworkId: r.buyer_network_id, buyerName: r.buyer_name, shipToName: r.ship_to_name, testMode: r.test_mode, uomMap: r.uom_map } : null;
}
export const getAribaMapping = (pool: Pool, tenantId: string) => withTenant(pool, tenantId, (c) => aribaMappingOf(c));

export async function saveAribaMapping(pool: Pool, who: Who, input: unknown): Promise<{ ok: true; mapping: AribaMapping } | { ok: false; error: string }> {
  if (!can(who, "config.manage")) return { ok: false, error: AR_NO_PERM };
  const v = checkAribaMapping(input);
  if (!v.ok) return v;
  const m = v.value;
  await withTenant(pool, who.tenantId, async (c) => {
    await c.query(`insert into ariba_mapping (tenant_id, buyer_network_id, buyer_name, ship_to_name, test_mode, uom_map, updated_by, updated_at) values ($1,$2,$3,$4,$5,$6,$7, now())
                   on conflict (tenant_id) do update set buyer_network_id = $2, buyer_name = $3, ship_to_name = $4, test_mode = $5, uom_map = $6, updated_by = $7, updated_at = now()`,
      [who.tenantId, m.buyerNetworkId, m.buyerName, m.shipToName || null, m.testMode, JSON.stringify(m.uomMap), who.membershipId]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "handover.ariba_mapping", { buyerNetworkId: m.buyerNetworkId, testMode: m.testMode, units: Object.keys(m.uomMap).length });
  });
  return { ok: true, mapping: m };
}

export type AribaOut = { ok: true; supplier: string; orderId: string; xml: string; warnings: string[] } | { ok: false; supplier: string; errors: string[] };

const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const DEC = /^\d+(\.\d+)?$/;

/** The award for one supplier as a cXML 1.2 OrderRequest. Nothing is guessed: a missing identity or unit is an error the buyer can fix. Values are XML-escaped. */
export function toAribaOrder(p: HandoverPayload, m: AribaMapping | null): AribaOut {
  const supplier = p.vendor.name, errors: string[] = [], warnings: string[] = [];
  if (!m) return { ok: false, supplier, errors: ["The Ariba mapping has not been set up. An administrator can add it under Configuration."] };
  const vendor = p.vendor.vendorCode;
  if (!vendor) errors.push(`${supplier} has no vendor number. Add the Ariba Network ID or supplier number on the supplier record.`);
  if (!p.awardedAt) errors.push("The award has no approval date.");
  if (!/^[A-Z]{3}$/.test(p.currency)) errors.push("The event currency is not a three-letter code.");
  const items: string[] = [];
  for (const it of p.items) {
    const n = `Line ${it.lineNo}`;
    const unit = m.uomMap[it.unit.toUpperCase()] ?? (/^[A-Z0-9]{1,3}$/.test(it.unit.toUpperCase()) ? it.unit.toUpperCase() : "");
    if (!unit) { errors.push(`${n}: no unit code for "${it.unit}". Add it to the unit map.`); continue; }
    if (!DEC.test(it.quantity) || Number(it.quantity) <= 0) { errors.push(`${n}: the quantity is not a positive number.`); continue; }
    if (!DEC.test(it.unitPrice)) { errors.push(`${n}: the unit price is not a number.`); continue; }
    if (!it.materialCode) warnings.push(`${n}: no part number, so the order line has no SupplierPartID.`);
    items.push(`<ItemOut quantity="${esc(it.quantity)}" lineNumber="${it.lineNo}"><ItemID><SupplierPartID>${esc(it.materialCode ?? "NA")}</SupplierPartID></ItemID><ItemDetail><UnitPrice><Money currency="${p.currency}">${esc(it.unitPrice)}</Money></UnitPrice><Description xml:lang="en">${esc(it.description.slice(0, 200))}</Description><UnitOfMeasure>${esc(unit)}</UnitOfMeasure><Classification domain="NotAvailable"/></ItemDetail></ItemOut>`);
  }
  if (!items.length && !errors.length) errors.push("There are no lines to hand over.");
  if (errors.length) return { ok: false, supplier, errors };
  warnings.push("Item classification is sent as NotAvailable. Confirm with your Ariba administrator that this is accepted.");
  const orderId = `${p.eventRef}-${vendor}`.slice(0, 50);
  const ts = new Date(p.awardedAt!).toISOString().replace(/\.\d+Z$/, "+00:00");
  const toDomain = /^AN\d+/i.test(vendor!) ? "NetworkID" : "VendorID";
  const buyer = `<Credential domain="NetworkID"><Identity>${esc(m.buyerNetworkId)}</Identity></Credential>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<cXML payloadID="${esc(orderId)}@aifexis" timestamp="${ts}" xml:lang="en"><Header><From>${buyer}</From><To><Credential domain="${toDomain}"><Identity>${esc(vendor!)}</Identity></Credential></To><Sender>${buyer}<UserAgent>Aifexis Sourcing</UserAgent></Sender></Header>`
    + `<Request deploymentMode="${m.testMode ? "test" : "production"}"><OrderRequest><OrderRequestHeader orderID="${esc(orderId)}" orderDate="${ts}" type="new"><Total><Money currency="${p.currency}">${esc(p.totalNet)}</Money></Total>`
    + `<ShipTo><Address><Name xml:lang="en">${esc(m.shipToName || m.buyerName)}</Name></Address></ShipTo><Comments xml:lang="en">${esc(`Award of ${p.eventRef}: ${p.title}`.slice(0, 300))}</Comments></OrderRequestHeader>${items.join("")}</OrderRequest></Request></cXML>\n`;
  return { ok: true, supplier, orderId, xml, warnings };
}
