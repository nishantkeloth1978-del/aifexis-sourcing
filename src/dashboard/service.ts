import type { Pool } from "pg";
import { withTenant } from "@/authz";
import type { Who } from "@/events/service";
import { COMMAND_LABEL, inbox } from "@/decisions/service";

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

/** One line on the "My actions" home. `text` is a fixed sentence with {placeholders}; `params` fill them. */
export interface Action { eventId: string; ref: string; title: string; text: string; params?: Record<string, string>; urgent: boolean; href: string }
export interface MyActions { now: Action[]; waiting: Action[]; soon: Action[] }

const WAITING_FOR: Record<string, string> = {
  pending_publication: "Waiting for publication approval",
  technical_evaluation: "Technical evaluation is in progress",
  pending_award: "Waiting for award approval",
};

/** What needs this person now, what they are waiting on others for, and what closes soon. */
export async function myActions(pool: Pool, who: Who): Promise<MyActions> {
  const tasks = await myTasks(pool, who);
  const now: Action[] = tasks.map((t) => ({ ...t, href: `/events/${t.eventId}` }));
  const asked = (await inbox(pool, who)).filter((d) => !d.stale);
  for (const d of asked.reverse()) now.unshift({ eventId: d.eventId, ref: d.eventRef, title: d.eventTitle, text: "Confirm: {0}", params: { "0": d.label }, urgent: true, href: "/decisions" });
  const waiting: Action[] = [], soon: Action[] = [];
  await withTenant(pool, who.tenantId, async (c) => {
    const mine = (await c.query(
      `select d.event_id, e.ref, e.title, d.command, d.status, du.email as designated_email
         from decision_request d join sourcing_event e on e.tenant_id = d.tenant_id and e.id = d.event_id
         join membership dm on dm.tenant_id = d.tenant_id and dm.id = d.designated join app_user du on du.id = dm.user_id
        where d.requested_by = $1 and d.status in ('pending', 'confirmed') and d.expires_at > now() and d.state_version = e.state_version
        order by d.created_at`, [who.membershipId])).rows;
    for (const r of mine) {
      const label = COMMAND_LABEL[r.command] ?? r.command;
      if (r.status === "confirmed") now.unshift({ eventId: r.event_id, ref: r.ref, title: r.title, text: "{0} confirmed: {1}. You can go ahead", params: { "0": r.designated_email, "1": label }, urgent: true, href: `/events/${r.event_id}` });
      else waiting.push({ eventId: r.event_id, ref: r.ref, title: r.title, text: "Waiting for {0} to confirm: {1}", params: { "0": r.designated_email, "1": label }, urgent: false, href: `/events/${r.event_id}` });
    }
    const evs = (await c.query(
      `select e.id, e.ref, e.title, e.state::text as state, e.closes_at, array_agg(distinct em.event_role) as roles
         from event_member em join sourcing_event e on e.tenant_id = em.tenant_id and e.id = em.event_id
        where em.membership_id = $1 and e.state in ('pending_publication', 'technical_evaluation', 'pending_award', 'published')
        group by e.tenant_id, e.id order by e.closes_at nulls last limit 60`, [who.membershipId])).rows;
    for (const e of evs) {
      const roles = new Set<string>(e.roles);
      const href = `/events/${e.id}`;
      if (WAITING_FOR[e.state] && (roles.has("buyer") || roles.has("requester"))) waiting.push({ eventId: e.id, ref: e.ref, title: e.title, text: WAITING_FOR[e.state]!, urgent: false, href });
      if (e.state === "published" && e.closes_at && (roles.has("buyer") || roles.has("requester"))) {
        const ms = new Date(e.closes_at).getTime() - Date.now();
        if (ms > 0 && ms <= 7 * 864e5) soon.push({ eventId: e.id, ref: e.ref, title: e.title, text: "Closes {0}", params: { "0": new Date(e.closes_at).toISOString().slice(0, 16).replace("T", " ") + " UTC" }, urgent: ms < 864e5, href });
      }
    }
  });
  return { now, waiting, soon };
}
