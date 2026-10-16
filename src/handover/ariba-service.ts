import type { Pool } from "pg";
import type { Who } from "@/events/service";
import { previewPayload } from "./service";
import { getAribaMapping, toAribaOrder, type AribaOut } from "./ariba";

/** The Ariba order(s) for an awarded event. Buyer of the event or an administrator only (same rule as the payload download). */
export async function previewAriba(pool: Pool, who: Who, eventId: string, supplierId?: string): Promise<{ ok: true; ref: string; docs: AribaOut[] } | { ok: false; error: string }> {
  const r = await previewPayload(pool, who, eventId, "ARIBA", supplierId);
  if (!r.ok) return r;
  const m = await getAribaMapping(pool, who.tenantId);
  return { ok: true, ref: r.payload.eventRef, docs: r.payloads.map((p) => toAribaOrder(p, m)) };
}
