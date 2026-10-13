"use server";
import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";
import { getPlatformUser } from "@/lib/session";
import { allow, TOO_FAST } from "@/lib/ratelimit";
import { createTenant, inviteTenantAdmin, setTenantSuspended } from "@/platform/service";

const DENIED = { ok: false as const, error: "Not allowed." };
async function run<T>(fn: () => Promise<T>) {
  const u = await getPlatformUser(); if (!u) return DENIED;
  if (!(await allow(getPool(), [[`platform:${u.email}`, 60, 30]]))) return { ok: false as const, error: TOO_FAST };
  try { const r = await fn(); revalidatePath("/platform"); return r; } catch { return { ok: false as const, error: "That could not be saved. Try again." }; }
}
export const createTenantAction = async (name: string, adminEmail: string) => run(() => createTenant(getPool(), name, adminEmail));
export const inviteTenantAdminAction = async (tenantId: string, email: string) => run(() => inviteTenantAdmin(getPool(), tenantId, email));
export const setSuspendedAction = async (tenantId: string, suspended: boolean) => run(() => setTenantSuspended(getPool(), tenantId, suspended));
