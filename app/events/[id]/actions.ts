"use server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { addItem, deleteItem, updateEventBasics, type CreateInput, type EventItem, type EventSummary, type ItemInput, type Result } from "@/events/service";

const NO_SESSION = { ok: false as const, error: "Your session has ended. Sign in again." };
const FAILED = { ok: false as const, error: "That could not be saved. Try again." };

export async function addItemAction(eventId: string, input: ItemInput): Promise<Result<{ item: EventItem }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await addItem(getPool(), s, eventId, input); } catch { return FAILED; }
}
export async function deleteItemAction(eventId: string, itemId: string): Promise<Result<object>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await deleteItem(getPool(), s, eventId, itemId); } catch { return FAILED; }
}
export async function updateBasicsAction(eventId: string, input: CreateInput): Promise<Result<{ event: EventSummary }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await updateEventBasics(getPool(), s, eventId, input); } catch { return FAILED; }
}

import { approvePublication, assignRole, removeRole, submitForPublication, type Outcome } from "@/events/workflow";

export async function assignRoleAction(eventId: string, membershipId: string, role: string): Promise<Outcome> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await assignRole(getPool(), s, eventId, membershipId, role); } catch { return FAILED; }
}
export async function removeRoleAction(eventId: string, membershipId: string, role: string): Promise<Outcome> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await removeRole(getPool(), s, eventId, membershipId, role); } catch { return FAILED; }
}
export async function submitAction(eventId: string, version: number): Promise<Outcome> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await submitForPublication(getPool(), s, eventId, version); } catch { return FAILED; }
}
export async function approveAction(eventId: string, version: number): Promise<Outcome> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await approvePublication(getPool(), s, eventId, version); } catch { return FAILED; }
}

import { approveTechnical, closeBidding, openTechnicalEnvelopes, saveScores, type EvalOut } from "@/evaluation/service";

export async function closeBiddingAction(eventId: string, version: number): Promise<EvalOut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await closeBidding(getPool(), s, eventId, version); } catch { return FAILED; }
}
export async function openEnvelopesAction(eventId: string, version: number, witnessMembershipId: string): Promise<EvalOut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await openTechnicalEnvelopes(getPool(), s, eventId, version, witnessMembershipId); } catch { return FAILED; }
}
export async function saveScoresAction(eventId: string, supplierId: string, scores: Record<string, number>): Promise<EvalOut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await saveScores(getPool(), s, eventId, supplierId, scores); } catch { return FAILED; }
}
export async function approveTechnicalAction(eventId: string, version: number, ids: string[]): Promise<EvalOut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await approveTechnical(getPool(), s, eventId, version, ids); } catch { return FAILED; }
}

import { approveAwardNow, openCommercialEnvelopes, recordRecommendation, rejectAward, submitForAward, type ComOut } from "@/commercial/service";

export async function openCommercialAction(eventId: string, version: number, witness: string): Promise<ComOut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await openCommercialEnvelopes(getPool(), s, eventId, version, witness); } catch { return FAILED; }
}
export async function recommendAction(eventId: string, version: number, supplierId: string, note: string): Promise<ComOut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await recordRecommendation(getPool(), s, eventId, version, supplierId, note); } catch { return FAILED; }
}
export async function submitAwardAction(eventId: string, version: number): Promise<ComOut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await submitForAward(getPool(), s, eventId, version); } catch { return FAILED; }
}
export async function approveAwardAction(eventId: string, version: number): Promise<ComOut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await approveAwardNow(getPool(), s, eventId, version); } catch { return FAILED; }
}
export async function rejectAwardAction(eventId: string, version: number): Promise<ComOut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await rejectAward(getPool(), s, eventId, version); } catch { return FAILED; }
}

import { answerQuestion } from "@/clarifications/service";
export async function answerAction(eventId: string, questionId: string, text: string, share: boolean): Promise<{ ok: boolean; error?: string }> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await answerQuestion(getPool(), s, eventId, questionId, text, share); } catch { return FAILED; }
}
