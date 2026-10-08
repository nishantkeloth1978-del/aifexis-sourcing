"use server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { withinRate } from "@/lib/guard";
import { TOO_FAST } from "@/lib/ratelimit";
import { sendHandover, type HOut, type Target } from "@/handover/service";

export async function sendHandoverAction(eventId: string, target: Target, supplierId?: string): Promise<HOut<{ reference: string; duplicate: boolean }>> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Your session has ended. Sign in again." };
  if (!(await withinRate(s.membershipId, "ho", 30))) return { ok: false, error: TOO_FAST };
  try { return await sendHandover(getPool(), s, eventId, target, supplierId); } catch { return { ok: false, error: "That could not be sent. Try again." }; }
}
