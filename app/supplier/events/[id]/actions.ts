"use server";
import { getPool } from "@/lib/db";
import { getSupplierSession } from "@/lib/session";
import { submitBidForm, type BidOut } from "@/bids/service";

export async function submitBidAction(eventId: string, input: { prices: Record<string, string>; technicalText: string; idempotencyKey: string }): Promise<BidOut<{ revisionNo: number; total: string }>> {
  const who = await getSupplierSession();
  if (!who) return { ok: false, error: "Your session has ended. Sign in again." };
  try { return await submitBidForm(getPool(), who, eventId, input); } catch { return { ok: false, error: "That could not be submitted. Try again." }; }
}

import { askQuestion } from "@/clarifications/service";
export async function askQuestionAction(eventId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const who = await getSupplierSession();
  if (!who) return { ok: false, error: "Your session has ended. Sign in again." };
  try { return await askQuestion(getPool(), who, eventId, text); } catch { return { ok: false, error: "That could not be sent. Try again." }; }
}
