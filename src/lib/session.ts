import { cache } from "react";
import { getPool } from "./db";
import { supabaseServer } from "./supabase/server";

export interface Session {
  authUserId: string;
  email: string;
  tenantId: string;
  tenantName: string;
  userId: string;
  membershipId: string;
  role: string;
}

/**
 * The signed-in person and their tenant, or null. One database call per request (cached within the request).
 * The identity comes from Supabase Auth; tenant and role come only from our own tables.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub || !claims.email) return null;
  const res = await getPool().query(`select * from resolve_login($1, $2)`, [claims.sub, claims.email]);
  const row = res.rows[0];
  if (!row) return null;
  return { authUserId: claims.sub, email: String(claims.email), tenantId: row.tenant_id, tenantName: row.tenant_name, userId: row.user_id, membershipId: row.membership_id, role: row.role };
});

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
