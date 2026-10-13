import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { hashToken } from "@/suppliers/service";

/**
 * The platform owner console. Platform owners are people whose verified e-mail address is listed in PLATFORM_ADMIN_EMAILS
 * (comma separated, set only in the deployment). They create and suspend organisations; they never see an organisation's events or bids.
 */
export const platformAdmins = (env: Record<string, string | undefined> = process.env) =>
  new Set((env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
export const isPlatformAdmin = (email: string | null | undefined, env: Record<string, string | undefined> = process.env) => !!email && platformAdmins(env).has(email.toLowerCase());

export interface TenantRow { id: string; name: string; createdAt: string; suspended: boolean; members: number; admins: number; events: number; suppliers: number }
export type POut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[A-Za-z]{2,}$/;
const INVITE_DAYS = 14;

export async function listTenants(pool: Pool): Promise<TenantRow[]> {
  return (await pool.query(`select * from platform_list_tenants()`)).rows.map((r) => ({ id: r.id, name: r.name, createdAt: new Date(r.created_at).toISOString(), suspended: !!r.suspended_at,
    members: Number(r.members), admins: Number(r.admins), events: Number(r.events), suppliers: Number(r.suppliers) }));
}

/** Creates an organisation and the invitation for its first administrator. The link token is returned once. */
export async function createTenant(pool: Pool, name: string, adminEmail: string): Promise<POut<{ tenantId: string; token: string }>> {
  const n = String(name ?? "").trim().replace(/\s+/g, " "), email = String(adminEmail ?? "").trim().toLowerCase();
  if (n.length < 2 || n.length > 120) return { ok: false, error: "Enter the organisation name (2 to 120 characters)." };
  if (!EMAIL.test(email)) return { ok: false, error: "Enter a valid e-mail address for the first administrator." };
  const token = randomBytes(32).toString("base64url");
  try {
    const id = (await pool.query(`select platform_create_tenant($1, $2, $3, now() + make_interval(days => $4)) as id`, [n, email, hashToken(token), INVITE_DAYS])).rows[0].id as string;
    return { ok: true, tenantId: id, token };
  } catch (e) {
    return { ok: false, error: /name taken/.test((e as Error).message) ? "An organisation with that name already exists." : "The organisation could not be created. Try again." };
  }
}

export async function inviteTenantAdmin(pool: Pool, tenantId: string, adminEmail: string): Promise<POut<{ token: string }>> {
  const email = String(adminEmail ?? "").trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return { ok: false, error: "Organisation not found." };
  if (!EMAIL.test(email)) return { ok: false, error: "Enter a valid e-mail address." };
  const token = randomBytes(32).toString("base64url");
  const ok = (await pool.query(`select platform_invite_admin($1, $2, $3, now() + make_interval(days => $4)) as ok`, [tenantId, email, hashToken(token), INVITE_DAYS])).rows[0].ok as boolean;
  return ok ? { ok: true, token } : { ok: false, error: "Organisation not found." };
}

export async function setTenantSuspended(pool: Pool, tenantId: string, suspended: boolean): Promise<POut> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return { ok: false, error: "Organisation not found." };
  const ok = (await pool.query(`select platform_set_suspended($1, $2) as ok`, [tenantId, suspended])).rows[0].ok as boolean;
  return ok ? { ok: true } : { ok: false, error: "Organisation not found." };
}
