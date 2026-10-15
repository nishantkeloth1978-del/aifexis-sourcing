"use server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { saveConfig, type CfgOut, type EvalConfig } from "@/config/service";
import { can } from "@/access/permissions";
import { withinRate } from "@/lib/guard";
import { TOO_FAST } from "@/lib/ratelimit";
import { complete } from "@/messages/ai";
import { testScanner } from "@/files/scan";
import { revalidatePath } from "next/cache";
import { I_FAILED, createClient, replayDelivery, revokeClient } from "@/integrations/service";
import { P_FAILED, savePolicy } from "@/automation/policy";
import type { Policy } from "@/automation/policy-types";
import { M_SAVE_FAILED, claudeFor, removeKey, saveSettings, setKey, testProvider, type SaveResult } from "@/assistant/models";

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
  const r = await complete("Reply with the single word OK.", "Connection check.", 8, { claude: await claudeFor(getPool(), s.tenantId) });
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

/** Stores one provider's API key, encrypted. Write-only: the key is never returned. */
export async function saveAssistantKeyAction(provider: string, key: string): Promise<{ ok: true; last4: string } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Your session has ended. Sign in again." };
  if (!(await withinRate(s.membershipId, "keyset", 20))) return { ok: false, error: TOO_FAST };
  try { return await setKey(getPool(), s, provider, key); } catch { return { ok: false, error: M_SAVE_FAILED }; }
}

export async function removeAssistantKeyAction(provider: string): Promise<{ ok: boolean; error?: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Your session has ended. Sign in again." };
  try { return await removeKey(getPool(), s, provider); } catch { return { ok: false, error: M_SAVE_FAILED }; }
}

/** One tiny request with the key and model name in force for a provider so an administrator can check them at once. */
export async function testAssistantModelAction(provider: string): Promise<{ ok: boolean; message: string; detail?: string }> {
  const s = await getSession();
  if (!s) return { ok: false, message: "Your session has ended. Sign in again." };
  if (!can(s, "config.manage")) return { ok: false, message: "Only an administrator can do that." };
  if (!(await withinRate(s.membershipId, "modeltest", 10))) return { ok: false, message: TOO_FAST };
  try { return await testProvider(getPool(), s, provider); } catch { return { ok: false, message: "The provider could not be reached or did not answer." }; }
}

/** What the system may do on its own: reminders, one capped extension, approver reminders, and the pause switch. */
export async function saveAutomationPolicyAction(input: unknown): Promise<{ ok: true; policy: Policy } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Your session has ended. Sign in again." };
  try { return await savePolicy(getPool(), s, input); } catch { return { ok: false, error: P_FAILED }; }
}

export async function createIntegrationAction(input: { name: string; scopes: string[]; webhookUrl?: string; events?: string[] }) {
  const s = await getSession();
  if (!s) return { ok: false as const, error: "Your session has ended. Sign in again." };
  if (!(await withinRate(s.membershipId, "integ", 10))) return { ok: false as const, error: TOO_FAST };
  try { const r = await createClient(getPool(), s, input); revalidatePath("/configuration"); return r; } catch { return { ok: false as const, error: I_FAILED }; }
}
export async function revokeIntegrationAction(id: string) {
  const s = await getSession();
  if (!s) return { ok: false as const, error: "Your session has ended. Sign in again." };
  try { const r = await revokeClient(getPool(), s, id); revalidatePath("/configuration"); return r; } catch { return { ok: false as const, error: I_FAILED }; }
}
export async function replayDeliveryAction(id: number) {
  const s = await getSession();
  if (!s) return { ok: false as const, error: "Your session has ended. Sign in again." };
  try { const r = await replayDelivery(getPool(), s, id); revalidatePath("/configuration"); return r; } catch { return { ok: false as const, error: I_FAILED }; }
}
