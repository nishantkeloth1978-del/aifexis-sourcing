import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Pool } from "pg";
import { withTenant } from "@/authz";
import { decryptKey } from "@/assistant/keys";

/** Delays before each retry; after the last one (about 21 hours in all) or 24 hours since creation the delivery is marked dead and can be replayed by hand. */
export const BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600, 43200];

export const sign = (secret: string, timestamp: string, body: string) => `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

const privateV4 = (ip: string) => {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
};
const privateAddr = (ip: string) => isIP(ip) === 4 ? privateV4(ip) : /^(::1?|fe80|fc|fd|::ffff:)/i.test(ip);

/** A webhook address must be https, name a public host and carry no login. Checked when saved and again when sending. */
export function checkWebhookUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "Enter the webhook address as a full https:// address."; }
  if (u.protocol !== "https:") return "The webhook address must start with https://.";
  if (u.username || u.password) return "The webhook address cannot contain a login.";
  if (raw.length > 500) return "The webhook address is too long.";
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || (isIP(h) && privateAddr(h)) || h.startsWith("[")) return "The webhook address must be a public host.";
  return null;
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

export type Sender = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; redirect: "manual"; signal: AbortSignal }) => Promise<{ status: number }>;
const defaultSender: Sender = (url, init) => fetch(url, init).then((r) => ({ status: r.status }));

export async function deliverDue(pool: Pool, tenantId: string, opts: { send?: Sender; resolve?: Resolver; now?: number } = {}): Promise<{ delivered: number; failed: number }> {
  const send = opts.send ?? defaultSender, resolve = opts.resolve ?? defaultResolver;
  const due = await withTenant(pool, tenantId, async (c) => (await c.query(
    `select d.id, d.client_id, d.event_type, d.payload, d.attempts, d.created_at, c.webhook_url, c.webhook_secret_enc
       from webhook_delivery d join integration_client c on c.tenant_id = d.tenant_id and c.id = d.client_id
      where d.state = 'pending' and d.next_attempt_at <= now() order by d.next_attempt_at limit 20`)).rows);
  let delivered = 0, failed = 0;
  for (const d of due) {
    let status: number | null = null, error: string | null = null;
    const secret = d.webhook_secret_enc ? decryptKey(d.webhook_secret_enc, tenantId, `webhook:${d.client_id}`) : null;
    try {
      const bad = d.webhook_url ? checkWebhookUrl(d.webhook_url) : "No webhook address.";
      if (bad || !secret) error = bad ?? "The signing secret cannot be read.";
      else {
        const host = new URL(d.webhook_url).hostname;
        const addrs = await resolve(host);
        if (!addrs.length || addrs.some(privateAddr)) error = "The webhook host resolves to a private address.";
        else {
          const body = JSON.stringify(d.payload), ts = String(Math.floor((opts.now ?? Date.now()) / 1000));
          const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
          try {
            const res = await send(d.webhook_url, { method: "POST", redirect: "manual", signal: ctl.signal, body,
              headers: { "content-type": "application/json", "user-agent": "Aifexis-Webhooks/1", "x-aifexis-event": d.event_type, "x-aifexis-delivery": `${tenantId.slice(0, 8)}-${d.id}`, "x-aifexis-timestamp": ts, "x-aifexis-signature": sign(secret, ts, body) } });
            status = res.status;
            if (status < 200 || status > 299) error = `The receiver answered ${status}.`;
          } finally { clearTimeout(timer); }
        }
      }
    } catch (e) { error = e instanceof Error && e.name === "AbortError" ? "The receiver did not answer in time." : "The receiver could not be reached."; }
    const attempts = (d.attempts as number) + 1;
    const age = ((opts.now ?? Date.now()) - new Date(d.created_at).getTime()) / 1000;
    const ok = !error;
    const dead = !ok && (attempts > BACKOFF_SECONDS.length || age > 24 * 3600);
    await withTenant(pool, tenantId, (c) => c.query(
      `update webhook_delivery set attempts = $2, last_status = $3, last_error = $4, state = $5, delivered_at = case when $5 = 'delivered' then now() else null end,
         next_attempt_at = now() + make_interval(secs => $6) where id = $1`,
      [d.id, attempts, status, error, ok ? "delivered" : dead ? "dead" : "pending", BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)]]));
    if (ok) delivered++; else failed++;
  }
  return { delivered, failed };
}
