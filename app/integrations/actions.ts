"use server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { sendHandover, type HOut, type Target } from "@/handover/service";

export async function sendHandoverAction(eventId: string, target: Target): Promise<HOut<{ reference: string; duplicate: boolean }>> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Your session has ended. Sign in again." };
  try { return await sendHandover(getPool(), s, eventId, target); } catch { return { ok: false, error: "That could not be sent. Try again." }; }
}
