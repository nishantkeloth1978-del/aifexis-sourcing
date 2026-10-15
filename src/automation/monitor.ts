import type { Pool } from "pg";
import { withTenant } from "@/authz";
import type { Monitor } from "./monitor-types";
export type { Monitor };

const WINDOW_DAYS = 30;
/** What the automation did and how the work is flowing, for the last 30 days. Counts and durations from the audit log and agent runs; nothing here is estimated. */
export async function getMonitor(pool: Pool, tenantId: string): Promise<Monitor> {
  return withTenant(pool, tenantId, async (c) => {
    const win = `now() - interval '${WINDOW_DAYS} days'`;
    const aw = (await c.query(
      `with won as (select event_id, max(at) as done from audit_event where action = 'award.approved' and event_id is not null and at >= ${win} group by event_id),
            first as (select a.event_id, min(a.at) as began from audit_event a join won w on w.event_id = a.event_id group by a.event_id),
            steps as (select a.event_id, count(*)::int n from audit_event a join won w on w.event_id = a.event_id where a.action like 'transition:%' group by a.event_id)
       select count(*)::int as n,
              percentile_cont(0.5) within group (order by extract(epoch from (w.done - f.began)) / 86400) as med,
              avg(s.n) as steps
         from won w join first f on f.event_id = w.event_id left join steps s on s.event_id = w.event_id`)).rows[0];
    const auto = (await c.query(`select count(*)::int n from audit_event where action like 'autonomy.auto%' and at >= ${win}`)).rows[0].n as number;
    const agents = (await c.query(
      `select agent, count(*)::int runs, count(*) filter (where state = 'failed')::int failed, count(*) filter (where state = 'accepted')::int accepted, count(*) filter (where state = 'rejected')::int rejected
         from agent_run where created_at >= ${win} group by agent order by agent`)).rows;
    const openChecks = (await c.query(`select count(*)::int n from bid_check where state = 'open'`)).rows[0].n as number;
    const wh = (await c.query(`select count(*) filter (where state = 'dead')::int dead, count(*) filter (where state = 'pending')::int pending from webhook_delivery`)).rows[0];
    const newRequests = (await c.query(`select count(*)::int n from purchase_request where state = 'new'`)).rows[0].n as number;
    return {
      days: WINDOW_DAYS, awarded: aw.n, medianCycleDays: aw.med === null ? null : Math.round(Number(aw.med) * 10) / 10, avgSteps: aw.steps === null ? null : Math.round(Number(aw.steps) * 10) / 10,
      auto, agents, openChecks, deadWebhooks: wh.dead, pendingWebhooks: wh.pending, newRequests,
    };
  });
}
