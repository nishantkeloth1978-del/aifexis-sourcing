import { cache } from "react";
import { getPool } from "./db";
import { supabaseServer } from "./supabase/server";
import { loadPerms } from "@/access/roles";
import { aalOk, needsStepUp } from "./assurance";

export interface Session {
  authUserId: string;
  email: string;
  tenantId: string;
  tenantName: string;
  userId: string;
  membershipId: string;
  role: string;
  perms: string[];
}

/**
 * The signed-in person and their tenant, or null. One database call per request (cached within the request).
 * The identity comes from Supabase Auth; tenant and role come only from our own tables.
 */
async function readSession(lowAssurance: boolean): Promise<(Session & { amr: unknown }) | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub || !claims.email) return null;
  if (!lowAssurance && !aalOk(claims.aal)) return null;   // password-only sessions get nothing when a second factor is required
  const res = await getPool().query(`select * from resolve_login($1, $2)`, [claims.sub, claims.email]);
  const row = res.rows[0];
  if (!row) return null;
  const perms = await loadPerms(getPool(), row.tenant_id, row.membership_id, row.role);
  return { authUserId: claims.sub, email: String(claims.email), tenantId: row.tenant_id, tenantName: row.tenant_name, userId: row.user_id, membershipId: row.membership_id, role: row.role, perms, amr: (claims as { amr?: unknown }).amr };
}

/** The signed-in staff member and their tenant, or null. Enforces the second factor when REQUIRE_MFA=true. */
export const getSession = cache(async (): Promise<Session | null> => readSession(false));
/** Only for the pages where someone is setting up or entering their second factor, and the page frame around them. */
export const getLowAssuranceSession = cache(async (): Promise<Session | null> => readSession(true));

/**
 * For actions that cannot be undone or that open sealed data: the session, but only if a second factor was confirmed in the last 10 minutes.
 * Without REQUIRE_MFA the check is off (there is no second factor to ask for).
 */
export async function getStepUpSession(): Promise<{ ok: true; session: Session } | { ok: false; reason: "NO_SESSION" | "STEP_UP" }> {
  const s = await readSession(false);
  if (!s) return { ok: false, reason: "NO_SESSION" };
  if (needsStepUp(s.amr)) return { ok: false, reason: "STEP_UP" };
  return { ok: true, session: s };
}

import type { SupplierWho } from "@/suppliers/service";
import { resolveSupplierLogin } from "@/suppliers/service";

/** The signed-in supplier contact (any tenant's invitation), or null. Kept apart from staff sessions. */
export const getSupplierSession = cache(async (): Promise<SupplierWho | null> => {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) return null;
  return resolveSupplierLogin(getPool(), sub);
});

import { isPlatformAdmin } from "@/platform/service";
/** The signed-in platform owner (listed in PLATFORM_ADMIN_EMAILS), or null. Independent of any organisation. */
export const getPlatformUser = cache(async (): Promise<{ email: string } | null> => {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  if (!aalOk(data?.claims?.aal)) return null;
  return data?.claims?.sub && isPlatformAdmin(email) ? { email: email! } : null;
});

/** For platform owners, who may have no organisation: true when a fresh second factor is required before a sensitive action. */
export async function platformNeedsStepUp(): Promise<boolean> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  return needsStepUp((data?.claims as { amr?: unknown } | undefined)?.amr);
}
