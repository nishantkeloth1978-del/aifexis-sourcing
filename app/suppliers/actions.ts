"use server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { createSupplier, inviteSupplier, type Out, type Supplier } from "@/suppliers/service";

const NO_SESSION = { ok: false as const, error: "Your session has ended. Sign in again." };
const FAILED = { ok: false as const, error: "That could not be saved. Try again." };

export async function createSupplierAction(input: { name: string; contactName: string; contactEmail: string }): Promise<Out<{ supplier: Supplier }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await createSupplier(getPool(), s, input); } catch { return FAILED; }
}
export async function inviteAction(eventId: string, supplierId: string): Promise<Out<{ token: string; expiresAt: string }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await inviteSupplier(getPool(), s, eventId, supplierId); } catch { return FAILED; }
}
