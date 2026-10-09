"use server";
import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { removeRoute, routeEventTeam, saveRoute, type RouteOut } from "@/events/routing";
import { startFinalRound } from "@/events/rounds";

const NO_SESSION = { ok: false as const, error: "Your session has ended. Sign in again." };
const FAILED = { ok: false as const, error: "That could not be saved. Try again." };

export async function saveRouteAction(input: { step: string; slot: number; ownerId: string; deputyId?: string | null; awayFrom?: string | null; awayTo?: string | null }): Promise<RouteOut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { const r = await saveRoute(getPool(), s, input); if (r.ok) revalidatePath("/approvers"); return r; } catch { return FAILED; }
}
export async function removeRouteAction(id: string): Promise<RouteOut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { const r = await removeRoute(getPool(), s, id); if (r.ok) revalidatePath("/approvers"); return r; } catch { return FAILED; }
}
export async function routeTeamAction(eventId: string): Promise<RouteOut<{ added: number }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await routeEventTeam(getPool(), s, eventId); } catch { return FAILED; }
}
export async function startFinalRoundAction(eventId: string, version: number, input: { shortlist: string[]; closesAt: string; reason: string; approverId: string }) {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await startFinalRound(getPool(), s, eventId, version, input); } catch { return FAILED; }
}
