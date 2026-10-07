"use server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { saveConfig, type CfgOut, type EvalConfig } from "@/config/service";

export async function saveConfigAction(input: EvalConfig): Promise<CfgOut<{ version: number }>> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Your session has ended. Sign in again." };
  try { return await saveConfig(getPool(), s, input); } catch { return { ok: false, error: "That could not be saved. Try again." }; }
}
