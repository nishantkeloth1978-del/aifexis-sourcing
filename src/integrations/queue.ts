import type { PoolClient } from "pg";
import type { WebhookEvent } from "./types";

export const MAX_PAYLOAD_BYTES = 256 * 1024;

/** Adds one pending delivery for every active client that listens for this event. Called inside the transaction that made the change. Never throws. */
export async function queueWebhook(c: PoolClient, tenantId: string, type: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  try {
    const body = { type, createdAt: new Date().toISOString(), data };
    if (JSON.stringify(body).length > MAX_PAYLOAD_BYTES) { body.data = { truncated: true }; }
    await c.query("savepoint wh_q");
    await c.query(
      `insert into webhook_delivery (tenant_id, client_id, event_type, payload)
       select tenant_id, id, $2, $3 from integration_client where tenant_id = $1 and active and revoked_at is null and webhook_url is not null and $2 = any(webhook_events)`,
      [tenantId, type, JSON.stringify(body)]);
    await c.query("release savepoint wh_q");
  } catch { await c.query("rollback to savepoint wh_q").catch(() => undefined); }
}

/** What the receiver needs to know about an event, with the request it came from. */
export async function eventFacts(c: PoolClient, eventId: string) {
  const r = (await c.query(
    `select e.ref, e.title, e.state::text as state, e.currency, p.ref as request_ref, p.external_ref from sourcing_event e left join purchase_request p on p.tenant_id = e.tenant_id and p.id = e.request_id where e.id = $1`, [eventId])).rows[0];
  return r ? { eventRef: r.ref as string, title: r.title as string, state: r.state as string, requestRef: (r.request_ref as string | null) ?? null, externalRef: (r.external_ref as string | null) ?? null } : null;
}

