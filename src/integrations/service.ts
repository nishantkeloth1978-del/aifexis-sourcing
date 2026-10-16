import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { withTenant } from "@/authz";
import { audit } from "@/authz/service";
import { can } from "@/access/permissions";
import { encryptionReady, encryptKey } from "@/assistant/keys";
import type { Who } from "@/events/service";
import { SCOPES, WEBHOOK_EVENTS, type ClientInfo, type DeliveryInfo, type IntegrationScreen } from "./types";
import { checkWebhookUrl } from "./webhooks";

export type IOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export const I_NO_PERM = "Only an administrator can manage integrations.";
export const I_NO_SECRET = "The server has no signing secret, so keys cannot be stored safely.";
export const I_BAD_NAME = "Enter a name of 2 to 80 characters.";
export const I_NOT_FOUND = "That connection was not found.";
export const I_FAILED = "That could not be saved. Try again.";
export const INTEGRATION_MESSAGES = [I_NO_PERM, I_NO_SECRET, I_BAD_NAME, I_NOT_FOUND, I_FAILED];

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export async function createClient(pool: Pool, who: Who, input: { name: string; scopes?: string[]; webhookUrl?: string; events?: string[]; autoEvent?: boolean }): Promise<IOut<{ key: string; webhookSecret: string | null; client: ClientInfo }>> {
  if (!can(who, "integration.manage")) return { ok: false, error: I_NO_PERM };
  if (!encryptionReady()) return { ok: false, error: I_NO_SECRET };
  const name = String(input.name ?? "").trim();
  if (name.length < 2 || name.length > 80) return { ok: false, error: I_BAD_NAME };
  const scopes = [...new Set((input.scopes?.length ? input.scopes : ["requests:write", "requests:read"]).filter((s) => (SCOPES as readonly string[]).includes(s)))];
  if (!scopes.length) return { ok: false, error: "Choose at least one permission for this connection." };
  const url = String(input.webhookUrl ?? "").trim();
  if (url) { const bad = checkWebhookUrl(url); if (bad) return { ok: false, error: bad }; }
  const events = url ? [...new Set((input.events ?? []).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e)))] : [];
  if (url && !events.length) return { ok: false, error: "Choose at least one event to send." };
  const prefix = randomBytes(6).toString("hex"), key = `aifx_${prefix}_${randomBytes(32).toString("base64url")}`;
  const secret = url ? `whsec_${randomBytes(32).toString("base64url")}` : null;
  try {
    return await withTenant(pool, who.tenantId, async (c) => {
      const id = (await c.query(
        `insert into integration_client (tenant_id, name, key_prefix, key_hash, scopes, owner_membership_id, webhook_url, webhook_events, created_by, auto_event) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [who.tenantId, name, prefix, hashKey(key), scopes, who.membershipId, url || null, events, who.userId, input.autoEvent === true && scopes.includes("requests:write")])).rows[0].id as string;
      if (secret) await c.query(`update integration_client set webhook_secret_enc = $2 where id = $1`, [id, encryptKey(secret, who.tenantId, `webhook:${id}`)]);
      await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "integration.client_created", { name, scopes, webhook: !!url, autoEvent: input.autoEvent === true });
      return { ok: true as const, key, webhookSecret: secret, client: { id, name, keyPrefix: prefix, scopes, webhookUrl: url || null, webhookEvents: events, active: true, lastUsedAt: null, createdAt: new Date().toISOString(), pending: 0, dead: 0, autoEvent: input.autoEvent === true && scopes.includes("requests:write") } };
    });
  } catch { return { ok: false, error: I_FAILED }; }
}

export async function revokeClient(pool: Pool, who: Who, id: string): Promise<IOut> {
  if (!can(who, "integration.manage")) return { ok: false, error: I_NO_PERM };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: I_NOT_FOUND };
  return withTenant(pool, who.tenantId, async (c) => {
    const r = await c.query(`update integration_client set active = false, revoked_at = now() where id = $1 and revoked_at is null returning name`, [id]);
    if (!r.rowCount) return { ok: false as const, error: I_NOT_FOUND };
    await c.query(`update webhook_delivery set state = 'dead', last_error = 'The connection was revoked.' where client_id = $1 and state = 'pending'`, [id]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "integration.client_revoked", { name: r.rows[0].name });
    return { ok: true as const };
  });
}

export async function replayDelivery(pool: Pool, who: Who, id: number): Promise<IOut> {
  if (!can(who, "integration.manage")) return { ok: false, error: I_NO_PERM };
  if (!Number.isInteger(id)) return { ok: false, error: I_NOT_FOUND };
  return withTenant(pool, who.tenantId, async (c) => {
    const r = await c.query(`update webhook_delivery d set state = 'pending', attempts = 0, next_attempt_at = now(), created_at = now(), last_error = null
        from integration_client k where d.id = $1 and d.state <> 'pending' and k.tenant_id = d.tenant_id and k.id = d.client_id and k.revoked_at is null returning d.event_type`, [id]);
    if (!r.rowCount) return { ok: false as const, error: I_NOT_FOUND };
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "integration.delivery_replayed", { id, type: r.rows[0].event_type });
    return { ok: true as const };
  });
}

export async function integrationScreen(pool: Pool, who: Who): Promise<IntegrationScreen | null> {
  if (!can(who, "integration.manage")) return null;
  return withTenant(pool, who.tenantId, async (c) => {
    const clients = (await c.query(
      `select k.*, (select count(*)::int from webhook_delivery d where d.client_id = k.id and d.state = 'pending') as pending,
              (select count(*)::int from webhook_delivery d where d.client_id = k.id and d.state = 'dead') as dead
         from integration_client k order by k.created_at desc limit 50`)).rows.map((r): ClientInfo => ({ id: r.id, name: r.name, keyPrefix: r.key_prefix, scopes: r.scopes, webhookUrl: r.webhook_url, webhookEvents: r.webhook_events, active: r.active && !r.revoked_at, lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null, createdAt: new Date(r.created_at).toISOString(), pending: r.pending, dead: r.dead, autoEvent: Boolean(r.auto_event) }));
    const deliveries = (await c.query(
      `select d.id, k.name, d.event_type, d.state, d.attempts, d.last_status, d.last_error, d.created_at, d.next_attempt_at from webhook_delivery d join integration_client k on k.tenant_id = d.tenant_id and k.id = d.client_id order by d.created_at desc limit 30`)).rows
      .map((r): DeliveryInfo => ({ id: Number(r.id), clientName: r.name, eventType: r.event_type, state: r.state, attempts: r.attempts, lastStatus: r.last_status, lastError: r.last_error, createdAt: new Date(r.created_at).toISOString(), nextAttemptAt: r.state === "pending" ? new Date(r.next_attempt_at).toISOString() : null }));
    return { clients, deliveries };
  });
}
