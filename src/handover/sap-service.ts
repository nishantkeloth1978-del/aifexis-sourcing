import type { Pool } from "pg";
import type { Who } from "@/events/service";
import { previewPayload } from "./service";
import { getMapping, toSapPo, type SapOut } from "./sap";

/** The SAP purchase order(s) for an awarded event. Buyer of the event or an administrator only (same rule as the payload download). */
export async function previewSap(pool: Pool, who: Who, eventId: string, supplierId?: string): Promise<{ ok: true; ref: string; docs: SapOut[] } | { ok: false; error: string }> {
  const r = await previewPayload(pool, who, eventId, "SAP", supplierId);
  if (!r.ok) return r;
  const m = await getMapping(pool, who.tenantId);
  return { ok: true, ref: r.payload.eventRef, docs: r.payloads.map((p) => toSapPo(p, m)) };
}
