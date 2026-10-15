"use server";
import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { withinRate } from "@/lib/guard";
import { TOO_FAST } from "@/lib/ratelimit";
import { acceptDraft, discardDraft, draftRequest, type Proposal } from "@/agents/drafter";
import { importRequestsCsv, type ImportResult } from "@/requests/import";
import { convertToEvent, createRequest, rejectRequest, withdrawRequest, type RequestInput, type RequestSummary, type ROut } from "@/requests/service";

const NO_SESSION = { ok: false as const, error: "Your session has ended. Sign in again." };
const FAILED = { ok: false as const, error: "That could not be saved. Try again." };

export async function createRequestAction(input: RequestInput): Promise<ROut<{ request: RequestSummary }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.membershipId, "request", 20))) return { ok: false, error: TOO_FAST };
  try { const r = await createRequest(getPool(), s, input); if (r.ok) revalidatePath("/requests"); return r; } catch { return FAILED; }
}
export async function withdrawRequestAction(id: string): Promise<ROut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { const r = await withdrawRequest(getPool(), s, id); revalidatePath("/requests"); revalidatePath(`/requests/${id}`); return r; } catch { return FAILED; }
}
export async function rejectRequestAction(id: string, note: string): Promise<ROut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { const r = await rejectRequest(getPool(), s, id, note); revalidatePath("/requests"); revalidatePath(`/requests/${id}`); return r; } catch { return FAILED; }
}
export async function convertRequestAction(id: string): Promise<ROut<{ eventId: string; eventRef: string }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { const r = await convertToEvent(getPool(), s, id); revalidatePath("/requests"); revalidatePath("/"); return r; } catch { return FAILED; }
}

export async function importRequestsAction(text: string): Promise<ImportResult | { ok: false; error: string }> {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.membershipId, "reqimport", 5))) return { ok: false, error: TOO_FAST };
  try { const r = await importRequestsCsv(getPool(), s, text); if (r.ok) revalidatePath("/requests"); return r; } catch { return FAILED; }
}

export async function draftRequestAction(id: string): Promise<ROut<Proposal>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.membershipId, "agentdraft", 6))) return { ok: false, error: TOO_FAST };
  try { return await draftRequest(getPool(), s, id); } catch { return FAILED; }
}
export async function acceptDraftAction(runId: string, draft: unknown): Promise<ROut<{ eventId: string; eventRef: string }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { const r = await acceptDraft(getPool(), s, runId, draft); if (r.ok) revalidatePath("/requests"); return r; } catch { return FAILED; }
}
export async function discardDraftAction(runId: string): Promise<ROut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await discardDraft(getPool(), s, runId); } catch { return FAILED; }
}
