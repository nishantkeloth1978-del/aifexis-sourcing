"use server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { withinRate } from "@/lib/guard";
import { TOO_FAST } from "@/lib/ratelimit";
import { createSupplier, inviteSupplier, type Out, type Supplier } from "@/suppliers/service";
import { importSuppliers, setSupplierStatus, updateSupplier, type ProfileInput, type SupplierImportRow } from "@/suppliers/master";
import { parseSuppliersSheet } from "@/suppliers/sheet";

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
export async function updateSupplierAction(id: string, input: Omit<ProfileInput, "contactEmail">): Promise<Out<{ supplier: Supplier }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await updateSupplier(getPool(), s, id, input); } catch { return FAILED; }
}
export async function setSupplierStatusAction(id: string, status: "active" | "blocked"): Promise<Out<{ status: string }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await setSupplierStatus(getPool(), s, id, status); } catch { return FAILED; }
}
export async function previewSuppliersAction(form: FormData): Promise<{ ok: true; rows: SupplierImportRow[]; errors: { row: number; message: string }[]; total: number } | { ok: false; error: string }> {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.membershipId, "up", 20))) return { ok: false, error: TOO_FAST };
  const f = form.get("file");
  if (!(f instanceof File)) return { ok: false, error: "Choose a file." };
  if (f.size > 2 * 1024 * 1024) return { ok: false, error: "The file is larger than 2 MB." };
  try {
    const r = await parseSuppliersSheet(f.name, Buffer.from(await f.arrayBuffer()));
    return "fatal" in r ? { ok: false, error: r.fatal } : { ok: true, ...r };
  } catch { return { ok: false, error: "That file could not be read." }; }
}
export async function importSuppliersAction(rows: SupplierImportRow[]): Promise<Out<{ added: number; skipped: { row: number; reason: string }[] }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await importSuppliers(getPool(), s, rows); } catch { return FAILED; }
}

import { addToPlan, freshLinks, removeFromPlan } from "@/suppliers/plan";
export async function planAddAction(eventId: string, input: { supplierIds?: string[]; category?: string }): Promise<Out<{ added: number }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await addToPlan(getPool(), s, eventId, input); } catch { return FAILED; }
}
export async function planRemoveAction(eventId: string, supplierId: string): Promise<Out> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await removeFromPlan(getPool(), s, eventId, supplierId); } catch { return FAILED; }
}
export async function freshLinksAction(eventId: string): Promise<Out<{ links: { supplier: string; email: string; url: string }[] }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await freshLinks(getPool(), s, eventId); } catch { return FAILED; }
}

import { decideApplication, setRegistration, type Registration } from "@/suppliers/registration";
export async function setRegistrationAction(enabled: boolean, renew = false): Promise<Out<{ registration: Registration }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await setRegistration(getPool(), s, enabled, renew); } catch { return FAILED; }
}
export async function decideApplicationAction(id: string, approve: boolean, note?: string): Promise<Out> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await decideApplication(getPool(), s, id, approve, note); } catch { return FAILED; }
}
