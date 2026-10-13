"use server";
import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { stepUpSession } from "@/lib/stepup";
import { decide, requestDecision, withdraw, type DecisionOut } from "@/decisions/service";
import type { TransitionPayload } from "@/authz";

const NO_SESSION = { ok: false as const, error: "Your session has ended. Sign in again." };
const FAILED = { ok: false as const, error: "That could not be saved. Try again." };

export async function requestDecisionAction(eventId: string, version: number, command: string, payload: TransitionPayload): Promise<DecisionOut<{ requestId: string }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await requestDecision(getPool(), s, eventId, version, command, payload); } catch { return FAILED; }
}
export async function withdrawDecisionAction(requestId: string): Promise<DecisionOut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await withdraw(getPool(), s, requestId); } catch { return FAILED; }
}
/** Confirming or declining is a sensitive step: it needs a second factor confirmed in the last ten minutes. */
export async function decideAction(requestId: string, approve: boolean): Promise<DecisionOut> {
  const s = await stepUpSession("/decisions"); if (!s) return NO_SESSION;
  try { const r = await decide(getPool(), s, requestId, approve); if (r.ok) revalidatePath("/decisions"); return r; } catch { return FAILED; }
}
