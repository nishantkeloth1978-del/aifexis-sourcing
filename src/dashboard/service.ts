import type { Pool } from "pg";
import { withTenant } from "@/authz";
import type { Who } from "@/events/service";

export interface Task { eventId: string; ref: string; title: string; text: string; urgent: boolean }

/** What this person has to do next, across events, from their event roles and where each event stands. */
export async function myTasks(pool: Pool, who: Who): Promise<Task[]> {
  return withTenant(pool, who.tenantId, async (c) => {
    const rows = (await c.query(
      `select e.id, e.ref, e.title, e.state::text as state, e.closes_at, array_agg(distinct em.event_role) as roles
         from event_member em join sourcing_event e on e.tenant_id = em.tenant_id and e.id = em.event_id
        where em.membership_id = $1 and e.state not in ('archived', 'cancelled', 'retendered', 'handed_over')
        group by e.tenant_id, e.id order by e.created_at desc limit 60`, [who.membershipId])).rows;
    const out: Task[] = [];
    for (const r of rows) {
      const roles = new Set<string>(r.roles);
      const add = (text: string, urgent = false) => out.push({ eventId: r.id, ref: r.ref, title: r.title, text, urgent });
      const closed = r.closes_at && new Date(r.closes_at).getTime() <= Date.now();
      switch (r.state) {
        case "draft": if (roles.has("buyer")) add("Finish the event and submit it for approval"); break;
        case "pending_publication": if (roles.has("publication_approver")) add("Approve publication", true); break;
        case "published":
          if (roles.has("buyer")) {
            const q = (await c.query(`select count(*)::int n from message_thread where event_id = $1 and lane = 'board' and status = 'open'`, [r.id])).rows[0].n;
            if (q > 0) add(`Answer ${q} supplier ${q === 1 ? "question" : "questions"}`, true);
            if (closed) add("Closing time has passed: close bidding", true);
          }
          break;
        case "closed": if (roles.has("buyer")) add("Open the technical envelopes with a witness", true); break;
        case "technical_evaluation": {
          const bidders = (await c.query(`select count(distinct supplier_id)::int n from bid_revision where event_id = $1`, [r.id])).rows[0].n;
          if (roles.has("tech_evaluator")) {
            const done = (await c.query(`select count(*)::int n from (select supplier_id from tech_score where event_id = $1 and evaluator_membership_id = $2 group by supplier_id) x`, [r.id, who.membershipId])).rows[0].n;
            if (done < bidders) add(`Score ${bidders - done} ${bidders - done === 1 ? "bidder" : "bidders"}`, true);
          }
          if (roles.has("tech_approver")) add("Review scores and approve the technical result");
          break;
        }
        case "technical_approved": if (roles.has("buyer")) add("Open the commercial envelopes with a witness", true); break;
        case "commercial_evaluation": if (roles.has("buyer")) add("Review the ranking and record your recommendation", true); break;
        case "recommended": if (roles.has("buyer")) add("Submit the recommendation for award approval"); break;
        case "pending_award":
          if (roles.has("award_approver")) {
            const mine = (await c.query(`select 1 from approval where event_id = $1 and step = 'award' and approver_membership_id = $2`, [r.id, who.membershipId])).rowCount;
            if (!mine) add("Decide on the award", true);
          }
          break;
      }
    }
    return out.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  });
}
