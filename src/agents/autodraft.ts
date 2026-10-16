import type { Pool } from "pg";
import { withTenant } from "@/authz";
import { permsFor } from "@/access/roles";
import { policyOf } from "@/automation/policy";
import type { AiDeps } from "@/messages/ai";
import { notify } from "@/notifications/hooks";
import { buyerUsers } from "@/requests/service";
import type { Who } from "@/events/service";
import { draftRequest } from "./drafter";

export type AutoDraftResult = "drafted" | "skipped" | "failed";

/** The buyer the draft is recorded under: the first active administrator or event creator. Null when the company has none. */
async function buyerWho(pool: Pool, tenantId: string): Promise<Who | null> {
  return withTenant(pool, tenantId, async (c) => {
    for (const m of (await c.query(`select id, user_id, role from membership where disabled_at is null order by (role = 'admin') desc, created_at`)).rows) {
      const perms = await permsFor(c, m.id, m.role);
      if (m.role === "admin" || perms.includes("event.create")) return { tenantId, userId: m.user_id as string, membershipId: m.id as string, role: m.role as string, perms };
    }
    return null;
  });
}

/**
 * The AI first draft for one new request, when the company switched it on (Configuration > Automation, level 2).
 * It only stores a proposal and tells the buyers; a buyer reviews it and creates the draft event, and publication still needs approval.
 * Does nothing for a request that is no longer new or already has a draft run (so a failed run is not repeated; a buyer can retry by hand).
 */
export async function autoDraftRequest(pool: Pool, tenantId: string, requestId: string, deps: AiDeps = {}): Promise<AutoDraftResult> {
  const p = await withTenant(pool, tenantId, (c) => policyOf(c));
  if (!p.autoDraft || p.paused || p.level < 2) return "skipped";
  const open = await withTenant(pool, tenantId, async (c) => (await c.query(
    `select ref, title from purchase_request r where r.id = $1 and r.state = 'new' and r.event_id is null and not exists (select 1 from agent_run a where a.subject_id = r.id and a.agent = 'drafter')`, [requestId])).rows[0] as { ref: string; title: string } | undefined);
  if (!open) return "skipped";
  const who = await buyerWho(pool, tenantId);
  if (!who) return "skipped";
  const r = await draftRequest(pool, who, requestId, deps);
  if (!r.ok) return "failed";
  await withTenant(pool, tenantId, async (c) => notify(c, tenantId, await buyerUsers(c), null, "request_new", `AI draft ready for review on ${open.ref}: ${open.title}. Open the request to check it and create the event.`));
  return "drafted";
}

/** Backup for requests the immediate run missed (a restart, a time-out, a file import): drafts up to `max` requests that are over three minutes old. */
export async function sweepAutoDrafts(pool: Pool, tenantId: string, deps: AiDeps = {}, max = 2): Promise<number> {
  const p = await withTenant(pool, tenantId, (c) => policyOf(c));
  if (!p.autoDraft || p.paused || p.level < 2) return 0;
  const ids = await withTenant(pool, tenantId, async (c) => (await c.query(
    `select r.id from purchase_request r where r.state = 'new' and r.event_id is null and r.created_at < now() - interval '3 minutes' and r.created_at > now() - interval '3 days'
       and not exists (select 1 from agent_run a where a.subject_id = r.id and a.agent = 'drafter') order by r.created_at limit $1`, [max])).rows.map((x) => x.id as string));
  let n = 0;
  for (const id of ids) { try { if ((await autoDraftRequest(pool, tenantId, id, deps)) === "drafted") n++; } catch (e) { console.error("auto draft failed", e instanceof Error ? e.message : e); } }
  return n;
}
