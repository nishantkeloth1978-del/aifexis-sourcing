"use server";
import { getPool } from "@/lib/db";
import { getSession, getSupplierSession } from "@/lib/session";
import { markAllRead, markAllReadForSupplierUser } from "@/notifications/service";

export async function markAllReadAction(): Promise<void> {
  const s = await getSession();
  if (s) { await markAllRead(getPool(), s.tenantId, s.userId).catch(() => undefined); return; }
  const sup = await getSupplierSession();
  if (sup) await markAllReadForSupplierUser(getPool(), sup.tenantId, sup.supplierUserId).catch(() => undefined);
}
