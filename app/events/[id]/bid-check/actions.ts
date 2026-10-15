"use server";
import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { withinRate } from "@/lib/guard";
import { TOO_FAST } from "@/lib/ratelimit";
import { dismissCheck, requestClarification, runBidCheck } from "@/bids/bidcheck";

const NO_SESSION = { ok: false as const, error: "Your session has ended. Sign in again." };
const FAILED = { ok: false as const, error: "That could not be saved. Try again." };

export async function runBidCheckAction(eventId: string) {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.membershipId, "bidcheck", 6))) return { ok: false as const, error: TOO_FAST };
  try { const r = await runBidCheck(getPool(), s, eventId); revalidatePath(`/events/${eventId}/bid-check`); return r; } catch { return FAILED; }
}
export async function dismissCheckAction(eventId: string, id: string) {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { const r = await dismissCheck(getPool(), s, eventId, id); revalidatePath(`/events/${eventId}/bid-check`); return r; } catch { return FAILED; }
}
export async function requestClarificationAction(eventId: string, supplierId: string, ids: string[], days: number) {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.membershipId, "bidclar", 20))) return { ok: false as const, error: TOO_FAST };
  try { const r = await requestClarification(getPool(), s, eventId, supplierId, ids, days); revalidatePath(`/events/${eventId}/bid-check`); return r; } catch { return FAILED; }
}
