import { getPool } from "@/lib/db";
import { allow } from "@/lib/ratelimit";
import { authenticate, type ApiClient, type ApiOut } from "./api";

export const json = (o: ApiOut, extra: Record<string, string> = {}) => Response.json(o.body, { status: o.status, headers: { "cache-control": "no-store", ...extra } });
const fail = (status: number, code: string, message: string, extra: Record<string, string> = {}) => json({ status, body: { error: { code, message } } }, extra);

/** Sign-in for every /api/v1 call: bad keys are limited per address, good keys per client. */
export async function guard(req: Request): Promise<{ client: ApiClient } | { response: Response }> {
  const pool = getPool();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim().slice(0, 64) || "unknown";
  let client: ApiClient | null = null;
  try { client = await authenticate(pool, req.headers.get("authorization")); } catch { return { response: fail(500, "internal_error", "Something went wrong. Retry later.") }; }
  if (!client) {
    if (!(await allow(pool, [[`api-bad:${ip}`, 60, 20]], { failClosed: true }))) return { response: fail(429, "rate_limited", "Too many requests.", { "Retry-After": "60" }) };
    return { response: fail(401, "unauthorized", "Missing or invalid key.", { "WWW-Authenticate": "Bearer" }) };
  }
  if (!(await allow(pool, [[`api:${client.clientId}`, 60, 120]]))) return { response: fail(429, "rate_limited", "Too many requests.", { "Retry-After": "60" }) };
  return { client };
}
export { fail };
