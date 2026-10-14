import type { Pool } from "pg";
import { withTenant } from "@/authz";
import { getEvent, listEvents, type Who } from "@/events/service";
import { GROUP_STATES, STATE_GROUP } from "@/events/groups";
import { getEventTemplate } from "@/templates/events";

/**
 * What the assistant may look up. Every tool is read-only and runs as the signed-in person through the same service functions the screens use,
 * so company isolation and "only events you can see" apply exactly as they do on the Events page. Results are short, plain data: no values,
 * no supplier prices, no documents. Titles and names in the results are data, never instructions.
 */
export interface ToolSpec { name: string; description: string; input_schema: Record<string, unknown> }

export const TOOLS: ToolSpec[] = [
  { name: "list_events", description: "List the signed-in person's events (only events they may see). Use for questions like which events are open, close this week, or are in draft. Returns reference, title, department, status group and closing date.",
    input_schema: { type: "object", properties: {
      status: { type: "string", enum: ["draft", "open", "evaluating", "awarded", "cancelled", "all"], description: "Status group. Default all." },
      closing_within_days: { type: "integer", minimum: 1, maximum: 365, description: "Only events whose closing date is within this many days from now." },
      search: { type: "string", description: "Words that must appear in the title, reference or department." },
      limit: { type: "integer", minimum: 1, maximum: 25 } } } },
  { name: "event_status", description: "Look at one event by its reference (for example EV-2026-014) and say what is done and what is missing before it can be submitted for publication. Use for questions like why can't I submit this event.",
    input_schema: { type: "object", properties: { ref: { type: "string", description: "Event reference such as EV-2026-014." } }, required: ["ref"] } },
];

const dayMs = 86_400_000;
const cap = (s: string, n = 6000) => (s.length > n ? s.slice(0, n) + "…" : s);

export async function runTool(pool: Pool, who: Who, name: string, input: unknown, now = Date.now()): Promise<string> {
  const a = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  try {
    if (name === "list_events") {
      const status = typeof a.status === "string" ? a.status : "all";
      const days = Number.isInteger(a.closing_within_days) ? Math.min(Math.max(a.closing_within_days as number, 1), 365) : null;
      const search = typeof a.search === "string" ? a.search.toLowerCase().trim().slice(0, 80) : "";
      const limit = Number.isInteger(a.limit) ? Math.min(Math.max(a.limit as number, 1), 25) : 15;
      const groupOf: Record<string, string> = { draft: "Draft", open: "Open", evaluating: "Evaluating", awarded: "Awarded", cancelled: "Cancelled" };
      let rows = await listEvents(pool, who, 500);
      if (status !== "all" && groupOf[status]) rows = rows.filter((e) => GROUP_STATES[groupOf[status]!]!.includes(e.state));
      if (days !== null) rows = rows.filter((e) => e.closesAt && new Date(e.closesAt).getTime() >= now && new Date(e.closesAt).getTime() <= now + days * dayMs && STATE_GROUP[e.state] === "Open");
      if (search) rows = rows.filter((e) => `${e.title} ${e.ref} ${e.ownerDept}`.toLowerCase().includes(search));
      return JSON.stringify({ total: rows.length, shown: Math.min(rows.length, limit), events: rows.slice(0, limit).map((e) => ({ ref: e.ref, title: e.title, department: e.ownerDept, status: STATE_GROUP[e.state] ?? e.state, closes: e.closesAt })) });
    }
    if (name === "event_status") {
      const ref = typeof a.ref === "string" ? a.ref.trim().toUpperCase().slice(0, 30) : "";
      const hit = (await listEvents(pool, who, 1000)).find((e) => (e.ref ?? "").toUpperCase() === ref);
      if (!hit) return JSON.stringify({ found: false, note: "No event with that reference that this person can see." });
      const d = await getEvent(pool, who, hit.id);
      if (!d) return JSON.stringify({ found: false, note: "No event with that reference that this person can see." });
      const t = await getEventTemplate(pool, who, hit.id).catch(() => null);
      const team = await withTenant(pool, who.tenantId, async (c) => (await c.query(`select event_role, count(*)::int n from event_member where event_id = $1 group by event_role`, [hit.id])).rows as { event_role: string; n: number }[]);
      const n = (role: string) => team.find((r) => r.event_role === role)?.n ?? 0;
      const lotsWithout = d.lots.filter((l) => !d.items.some((i) => i.lotId === l.id)).length;
      const itemsWithoutLot = d.lots.length > 0 ? d.items.filter((i) => !i.lotId).length : 0;
      const future = d.closesAt ? new Date(d.closesAt).getTime() > now : false;
      const checks = [
        { check: "At least one item to price", ok: d.items.length > 0, detail: `${d.items.length} items` },
        { check: "Closing date in the future", ok: future, detail: d.closesAt ?? "not set" },
        ...(d.lots.length ? [{ check: "Every item in a lot and every lot has items", ok: lotsWithout === 0 && itemsWithoutLot === 0, detail: `${d.lots.length} lots, ${lotsWithout} empty, ${itemsWithoutLot} items without a lot` }] : []),
        ...(t ? [{ check: "Template inputs complete", ok: !t.schedule.incomplete, detail: t.schedule.incomplete ? `incomplete (${t.key} v${t.version})` : `${t.key} v${t.version}, ${t.schedule.items.length} lines` }] : []),
        { check: "Publication approver on the team", ok: n("publication_approver") > 0, detail: `${n("publication_approver")} assigned (not needed when the value is below the auto-approval threshold)` },
      ];
      return JSON.stringify({ found: true, ref: d.ref, title: d.title, status: STATE_GROUP[d.state] ?? d.state, state: d.state, closes: d.closesAt, items: d.items.length, lots: d.lots.length, checks });
    }
    return JSON.stringify({ error: "Unknown tool." });
  } catch (e) {
    if (process.env.ASSISTANT_DEBUG) console.error("[assistant] tool failed", name, e);
    return JSON.stringify({ error: "That lookup failed." });
  }
}
