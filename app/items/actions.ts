"use server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { withinRate } from "@/lib/guard";
import { TOO_FAST } from "@/lib/ratelimit";
import { addCatalogItem, importCatalog, updateCatalogItem, type CatalogInput, type CatalogItem, type COut } from "@/catalog/service";
import { parseCatalogSheet } from "@/catalog/sheet";

const NO_SESSION = { ok: false as const, error: "Your session has ended. Sign in again." };
const FAILED = { ok: false as const, error: "That could not be saved. Try again." };

export async function addCatalogAction(input: CatalogInput): Promise<COut<{ item: CatalogItem }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await addCatalogItem(getPool(), s, input); } catch { return FAILED; }
}
export async function updateCatalogAction(id: string, input: CatalogInput & { active?: boolean }): Promise<COut<{ item: CatalogItem }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await updateCatalogItem(getPool(), s, id, input); } catch { return FAILED; }
}
export async function previewCatalogAction(form: FormData): Promise<{ ok: true; rows: CatalogInput[]; errors: { row: number; message: string }[]; total: number } | { ok: false; error: string }> {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.membershipId, "up", 20))) return { ok: false, error: TOO_FAST };
  const f = form.get("file");
  if (!(f instanceof File)) return { ok: false, error: "Choose a file." };
  if (f.size > 2 * 1024 * 1024) return { ok: false, error: "The file is larger than 2 MB." };
  try {
    const r = await parseCatalogSheet(f.name, Buffer.from(await f.arrayBuffer()));
    return "fatal" in r ? { ok: false, error: r.fatal } : { ok: true, ...r };
  } catch { return { ok: false, error: "That file could not be read." }; }
}
export async function importCatalogAction(rows: CatalogInput[]): Promise<COut<{ added: number; updated: number }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await importCatalog(getPool(), s, rows); } catch { return FAILED; }
}
