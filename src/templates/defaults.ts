import type { Pool } from "pg";
import { audit, withTenant } from "@/authz";
import type { Who } from "@/events/service";
import { allTemplates, type TOut } from "./service";

export interface DefaultRow { eventType: "RFI" | "RFQ" | "RFP"; category: string; templateKey: string }
export const BUILT_IN_DEFAULT = (eventType: string) => `GEN_${eventType}`;
const TYPES = ["RFI", "RFQ", "RFP"];

export async function listDefaults(pool: Pool, who: Who): Promise<DefaultRow[]> {
  return withTenant(pool, who.tenantId, async (c) =>
    (await c.query(`select event_type, category_code, template_key from company_default_template order by event_type, category_code`)).rows
      .map((r) => ({ eventType: r.event_type, category: r.category_code, templateKey: r.template_key })));
}

/** Sets (or, with templateKey null, clears) the default for an event type, for one category or for any ('*'). Administrators only. */
export async function setDefault(pool: Pool, who: Who, eventType: string, category: string | null, templateKey: string | null): Promise<TOut> {
  if (who.role !== "admin") return { ok: false, error: "Only an administrator can set default templates." };
  if (!TYPES.includes(eventType)) return { ok: false, error: "Choose RFI, RFQ or RFP." };
  const cat = category || "*";
  return withTenant(pool, who.tenantId, async (c) => {
    if (cat !== "*" && !(await c.query(`select 1 from purchase_category where code = $1`, [cat])).rowCount) return { ok: false as const, error: "Unknown category." };
    if (templateKey === null) {
      await c.query(`delete from company_default_template where event_type = $1 and category_code = $2`, [eventType, cat]);
      await audit(c, { kind: "internal", userId: who.userId, tenantId: who.tenantId }, null, "template.default_cleared", { eventType, category: cat });
      return { ok: true as const };
    }
    const t = (await allTemplates(c)).find((x) => x.key === templateKey);
    if (!t || !t.enabled || t.missing.length > 0) return { ok: false as const, error: "Enable the template for your company before making it the default." };
    if (t.eventType !== eventType) return { ok: false as const, error: "That template is for a different event type." };
    await c.query(
      `insert into company_default_template (tenant_id, event_type, category_code, template_key, set_by) values ($1,$2,$3,$4,$5)
       on conflict (tenant_id, event_type, category_code) do update set template_key = excluded.template_key, set_by = excluded.set_by, set_at = now()`,
      [who.tenantId, eventType, cat, templateKey, who.membershipId]);
    await audit(c, { kind: "internal", userId: who.userId, tenantId: who.tenantId }, null, "template.default_set", { eventType, category: cat, templateKey });
    return { ok: true as const };
  });
}
