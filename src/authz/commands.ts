import type { PoolClient } from "pg";
import {
  actorLabel, audit, checkTransition, loadEvent, loadSubject, resolvePermitted, type TransitionPayload,
} from "./service";
import { TRANSITIONS } from "./rules";
import { allow, deny, type Actor, type DataClass, type Decision, type EventRow } from "./types";

/** Result of a state-changing command. */
export type CommandResult = { ok: true; duplicate?: boolean; event: EventRow } | { ok: false; decision: Decision };

async function membershipOf(client: PoolClient, userId: string): Promise<string | null> {
  const r = await client.query(`select id from membership where user_id = $1 order by id limit 1`, [userId]);
  return r.rows[0]?.id ?? null;
}

/**
 * Apply one lifecycle transition. The permission check and the state change run in the caller's transaction;
 * the state change is guarded by an optimistic version check so two simultaneous commands cannot both win.
 */
export async function applyTransition(
  client: PoolClient, actor: Actor, eventId: string, command: string,
  opts: { expectedVersion: number; payload?: TransitionPayload },
): Promise<CommandResult> {
  const payload = opts.payload ?? {};
  if (command === "ApproveAward") return approveAward(client, actor, eventId, opts.expectedVersion, payload.idempotencyKey ?? `${command}:${actorLabel(actor)}`);
  const decision = await checkTransition(client, actor, eventId, command, opts.expectedVersion, payload);
  if (!decision.allow) {
    await audit(client, actor, eventId, `denied:${command}`, { reason: decision.reason });
    return { ok: false, decision };
  }
  const def = TRANSITIONS[command]!;
  const event = (await loadEvent(client, eventId))!;
  const membership = actor.kind === "internal" ? await membershipOf(client, actor.userId) : null;
  const sets: string[] = ["state = $3", "state_version = state_version + 1"];
  const params: unknown[] = [eventId, opts.expectedVersion, def.to];

  switch (command) {
    case "ApprovePublication": {
      const cfg = await client.query(`select model from tenant_config order by version desc limit 1`);
      params.push(JSON.stringify(cfg.rows[0]?.model ?? null));
      sets.push(`config_snapshot = $${params.length}::jsonb`); // the configuration in force is frozen with the event
      break;
    }
    case "OpenEnvelope1":
      sets.push("envelope1_opened_at = now()");
      await client.query(
        `insert into opening_record (tenant_id, event_id, envelope, opened_by, witness) values ($1, $2, 1, $3, $4)`,
        [actor.tenantId, eventId, membership, payload.witnessMembershipId]);
      break;
    case "ApproveTechnicalResult": {
      const ids = payload.qualifiedSupplierIds ?? [];
      const bidders = await client.query(`select distinct supplier_id from bid_revision where event_id = $1`, [eventId]);
      const known = new Set(bidders.rows.map((r) => r.supplier_id));
      if (!ids.length || ids.some((i) => !known.has(i))) {
        return { ok: false, decision: deny("INVALID_QUALIFIED_LIST") };
      }
      for (const s of ids) {
        await client.query(`insert into qualified_bidder (tenant_id, event_id, supplier_id) values ($1, $2, $3)`, [actor.tenantId, eventId, s]);
      }
      await client.query(
        `insert into approval (tenant_id, event_id, step, approver_membership_id, decision, idempotency_key)
         values ($1, $2, 'technical', $3, 'approve', $4)`,
        [actor.tenantId, eventId, membership, payload.idempotencyKey ?? `technical:${eventId}:${event.stateVersion}`]);
      break;
    }
    case "OpenEnvelope2": {
      sets.push("envelope2_opened_at = now()");
      const q = await client.query(`select supplier_id from qualified_bidder where event_id = $1 and superseded_at is null order by supplier_id`, [eventId]);
      await client.query(
        `insert into opening_record (tenant_id, event_id, envelope, opened_by, witness, qualified_supplier_ids)
         values ($1, $2, 2, $3, $4, $5::uuid[])`,
        [actor.tenantId, eventId, membership, payload.witnessMembershipId, q.rows.map((r) => r.supplier_id)]);
      break;
    }
    case "ReopenForAmendment":
      // Re-seal: envelopes close again, the qualified list is superseded (not deleted), the definition version moves on.
      sets.push("envelope1_opened_at = null", "envelope2_opened_at = null", "current_version = current_version + 1");
      await client.query(`update qualified_bidder set superseded_at = now() where event_id = $1 and superseded_at is null`, [eventId]);
      break;
    default:
      break;
  }

  const upd = await client.query(
    `update sourcing_event set ${sets.join(", ")} where id = $1 and state_version = $2 returning id`, params);
  if (!upd.rows.length) return { ok: false, decision: deny("STALE_VERSION") };
  await audit(client, actor, eventId, `transition:${command}`, { from: event.state, to: def.to });
  await client.query(`insert into outbox (tenant_id, event_id, kind, payload) values ($1, $2, $3, $4)`,
    [actor.tenantId, eventId, `event.${command}`, JSON.stringify({ to: def.to })]);
  return { ok: true, event: (await loadEvent(client, eventId))! };
}

/**
 * Record an award approval. Idempotent: the same key returns the original outcome, writes one approval
 * and one audit record, even when two requests arrive at the same moment.
 */
export async function approveAward(
  client: PoolClient, actor: Actor, eventId: string, expectedVersion: number, idempotencyKey: string,
): Promise<CommandResult> {
  const decision = await checkTransition(client, actor, eventId, "ApproveAward", undefined);
  // A repeat after the event moved on is a duplicate, not an error, when the key already exists.
  const existing = await client.query(`select 1 from approval where idempotency_key = $1`, [idempotencyKey]);
  if (!decision.allow && existing.rows.length) return { ok: true, duplicate: true, event: (await loadEvent(client, eventId))! };
  if (!decision.allow) { await audit(client, actor, eventId, "denied:ApproveAward", { reason: decision.reason }); return { ok: false, decision }; }
  const before = (await loadEvent(client, eventId))!;
  if (before.stateVersion !== expectedVersion) {
    // A concurrent request with the same key may have just committed: that is a duplicate, not a stale write.
    const again = await client.query(`select 1 from approval where idempotency_key = $1`, [idempotencyKey]);
    if (again.rows.length) return { ok: true, duplicate: true, event: before };
    return { ok: false, decision: deny("STALE_VERSION") };
  }
  if (actor.kind !== "internal") return { ok: false, decision: deny("FORBIDDEN_ROLE") };
  const membership = await membershipOf(client, actor.userId);
  const ins = await client.query(
    `insert into approval (tenant_id, event_id, step, approver_membership_id, decision, idempotency_key)
     values ($1, $2, 'award', $3, 'approve', $4) on conflict do nothing returning id`,
    [actor.tenantId, eventId, membership, idempotencyKey]);
  if (!ins.rows.length) return { ok: true, duplicate: true, event: (await loadEvent(client, eventId))! };
  await audit(client, actor, eventId, "award.approved", { idempotencyKey });
  const cnt = await client.query(`select count(*)::int as n from approval where event_id = $1 and step = 'award' and decision = 'approve'`, [eventId]);
  if (cnt.rows[0].n >= before.requiredAwardApprovals) {
    await client.query(`update sourcing_event set state = 'awarded', state_version = state_version + 1 where id = $1 and state = 'pending_award'`, [eventId]);
    await client.query(`insert into outbox (tenant_id, event_id, kind, payload) values ($1, $2, 'award.approved', '{}')`, [actor.tenantId, eventId]);
  }
  return { ok: true, event: (await loadEvent(client, eventId))! };
}

export interface BidItemInput { dataClass: Extract<DataClass, "D6" | "D7">; kind: string; payload: unknown }

/**
 * Submit a bid revision as a supplier. Idempotent on the key: a retry returns the same revision.
 * Each submission after the first creates a new immutable revision.
 */
export async function submitBid(
  client: PoolClient, actor: Actor, eventId: string, input: { items: BidItemInput[]; idempotencyKey: string },
): Promise<{ ok: true; duplicate: boolean; revisionId: string; revisionNo: number } | { ok: false; decision: Decision }> {
  if (actor.kind !== "supplier") return { ok: false, decision: deny("FORBIDDEN_ROLE") };
  const r = await resolvePermitted(client, actor, eventId);
  if (!r.ok || !r.supplierId) return { ok: false, decision: deny("NOT_FOUND") };
  if (r.event.state !== "published") return { ok: false, decision: deny("BAD_STATE") };
  if (r.event.closesAt && r.event.closesAt.getTime() <= Date.now()) return { ok: false, decision: deny("DEADLINE_PASSED") };

  for (let attempt = 0; attempt < 3; attempt++) {
    const ins = await client.query(
      `insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key)
       select $1, $2, $3, coalesce(max(revision_no), 0) + 1, $4 from bid_revision
        where event_id = $2 and supplier_id = $3
       on conflict do nothing returning id, revision_no`,
      [actor.tenantId, eventId, r.supplierId, input.idempotencyKey]);
    if (ins.rows.length) {
      for (const item of input.items) {
        await client.query(
          `insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1, $2, $3, $4, $5)`,
          [actor.tenantId, ins.rows[0].id, item.dataClass, item.kind, JSON.stringify(item.payload)]);
      }
      await audit(client, actor, eventId, "bid.submitted", { revision: ins.rows[0].revision_no });
      return { ok: true, duplicate: false, revisionId: ins.rows[0].id, revisionNo: ins.rows[0].revision_no };
    }
    const ex = await client.query(
      `select id, revision_no from bid_revision where event_id = $1 and supplier_id = $2 and idempotency_key = $3`,
      [eventId, r.supplierId, input.idempotencyKey]);
    if (ex.rows.length) return { ok: true, duplicate: true, revisionId: ex.rows[0].id, revisionNo: ex.rows[0].revision_no };
    // a different submission took the revision number at the same instant: try again with the next number
  }
  return { ok: false, decision: deny("CONFLICT") };
}

export { allow, loadSubject };
