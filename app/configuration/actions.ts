"use server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { saveConfig, type CfgOut, type EvalConfig } from "@/config/service";
import { can } from "@/access/permissions";
import { withinRate } from "@/lib/guard";
import { TOO_FAST } from "@/lib/ratelimit";
import { complete } from "@/messages/ai";
import { testScanner } from "@/files/scan";
import { M_SAVE_FAILED, saveSettings, testModel, type SaveResult } from "@/assistant/models";

export async function saveConfigAction(input: EvalConfig): Promise<CfgOut<{ version: number }>> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Your session has ended. Sign in again." };
  try { return await saveConfig(getPool(), s, input); } catch { return { ok: false, error: "That could not be saved. Try again." }; }
}

/** One tiny request to the AI service so an administrator can check a new or rotated key at once. */
export async function testAiAction(): Promise<{ ok: boolean; error?: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Your session has ended. Sign in again." };
  if (!can(s, "config.manage")) return { ok: false, error: "Only an administrator can do that." };
  if (!(await withinRate(s.membershipId, "aitest", 5))) return { ok: false, error: TOO_FAST };
  const r = await complete("Reply with the single word OK.", "Connection check.", 8);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Sends the standard test virus and a harmless file to the external scanner; both must be answered correctly. */
export async function testScannerAction(): Promise<{ ok: boolean; error?: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Your session has ended. Sign in again." };
  if (!can(s, "config.manage")) return { ok: false, error: "Only an administrator can do that." };
  if (!(await withinRate(s.membershipId, "scantest", 5))) return { ok: false, error: TOO_FAST };
  return testScanner();
}

/** An administrator's choice of which models the assistant may use. Keys are never part of this: they live in the server environment. */
export async function saveAssistantSettingsAction(input: unknown): Promise<SaveResult> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Your session has ended. Sign in again." };
  try { return await saveSettings(getPool(), s, input); } catch { return { ok: false, error: M_SAVE_FAILED }; }
}

/** One tiny request to the chosen model so an administrator can check a key and a model name at once. */
export async function testAssistantModelAction(which: "free" | "claude"): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  if (!s) return { ok: false, message: "Your session has ended. Sign in again." };
  if (!can(s, "config.manage")) return { ok: false, message: "Only an administrator can do that." };
  if (!(await withinRate(s.membershipId, "modeltest", 10))) return { ok: false, message: TOO_FAST };
  try { return await testModel(getPool(), s, which === "claude" ? "claude" : "free"); } catch { return { ok: false, message: "The provider could not be reached or did not answer." }; }
}
