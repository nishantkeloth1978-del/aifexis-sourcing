import type { PoolClient } from "pg";

/** Writes notifications from inside the caller's tenant transaction. A failure here never blocks the business action. */
export async function notify(c: PoolClient, tenantId: string, userIds: (string | null | undefined)[], eventId: string | null, kind: string, message: string) {
  const ids = [...new Set(userIds.filter((x): x is string => Boolean(x)))];
  if (!ids.length) return;
  try {
    await c.query("savepoint notify_sp");
    for (const u of ids) await c.query(`insert into notification (tenant_id, user_id, event_id, kind, message) values ($1,$2,$3,$4,$5)`, [tenantId, u, eventId, kind, message.slice(0, 500)]);
    await c.query("release savepoint notify_sp");
  } catch { await c.query("rollback to savepoint notify_sp").catch(() => undefined); }
}

const staffWithRole = async (c: PoolClient, eventId: string, roles: string[]) =>
  (await c.query(`select m.user_id from event_member em join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id where em.event_id = $1 and em.event_role = any($2)`, [eventId, roles])).rows.map((r) => r.user_id as string);

/** Who needs to hear about a lifecycle step. Messages carry no bid content. */
export async function notifyTransition(c: PoolClient, tenantId: string, eventId: string, command: string) {
  try {
    const ref = (await c.query(`select ref from sourcing_event where id = $1`, [eventId])).rows[0]?.ref ?? "an event";
    const to = (roles: string[], kind: string, msg: string) => staffWithRole(c, eventId, roles).then((u) => notify(c, tenantId, u, eventId, kind, msg));
    switch (command) {
      case "SubmitForPublication": return await to(["publication_approver"], "approval_needed", `${ref} is waiting for your approval to publish.`);
      case "ApprovePublication": return await to(["buyer"], "published", `${ref} was approved and is now open. You can invite suppliers.`);
      case "OpenEnvelope1": return await to(["tech_evaluator", "tech_approver"], "scoring_open", `Technical envelopes of ${ref} are open. Scoring can begin.`);
      case "ApproveTechnicalResult": return await to(["buyer", "comm_evaluator"], "technical_approved", `The technical result of ${ref} was approved. The commercial envelopes can be opened.`);
      case "OpenEnvelope2": return await to(["comm_evaluator"], "commercial_open", `Commercial envelopes of ${ref} are open.`);
      case "SubmitForAward": return await to(["award_approver"], "approval_needed", `${ref} is waiting for your award decision.`);
      case "RejectAward": return await to(["buyer"], "award_returned", `The award decision for ${ref} was sent back to you.`);
    }
  } catch { /* notifications are best effort */ }
}

/** Called when the last required award approval lands: tell the buyer, and tell every supplier who bid how it went. */
export async function notifyAwarded(c: PoolClient, tenantId: string, eventId: string) {
  try {
    const ref = (await c.query(`select ref from sourcing_event where id = $1`, [eventId])).rows[0]?.ref ?? "an event";
    await notify(c, tenantId, await staffWithRole(c, eventId, ["buyer", "comm_evaluator"]), eventId, "awarded", `${ref} was awarded.`);
    const win = (await c.query(`select supplier_id from recommendation where event_id = $1 order by created_at desc limit 1`, [eventId])).rows[0]?.supplier_id;
    const bidders = (await c.query(`select distinct br.supplier_id, su.user_id from bid_revision br join supplier_user su on su.tenant_id = br.tenant_id and su.supplier_id = br.supplier_id where br.event_id = $1`, [eventId])).rows;
    for (const b of bidders) await notify(c, tenantId, [b.user_id], eventId, "award_result", b.supplier_id === win ? `${ref}: your bid was successful. The contract was awarded to you.` : `${ref}: the contract was awarded to another bidder. Thank you for bidding.`);
  } catch { /* best effort */ }
}
