"use server";
import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { withinRate } from "@/lib/guard";
import { TOO_FAST } from "@/lib/ratelimit";
import { activate, matchTemplate, previewSelection, saveProfile, setPolicy, type MatchInput, type MatchResult, type Policy, type Profile, type ProfileInput, type TOut } from "@/templates/service";
import { createEventFromTemplate, updateTemplateInputs, type FromTemplateInput } from "@/templates/events";
import type { Schedule, TemplateInputs } from "@/templates/schedule";

const NO_SESSION = { ok: false as const, error: "Your session has ended. Sign in again." };
const FAILED = { ok: false as const, error: "That could not be saved. Try again." };

export async function saveProfileAction(input: ProfileInput, expectedVersion: number): Promise<TOut<{ profile: Profile; gaps: string[] }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { const r = await saveProfile(getPool(), s, input, expectedVersion); if (r.ok) revalidatePath("/setup"); return r; } catch { return FAILED; }
}
export async function setPolicyAction(p: Pick<Policy, "key" | "kind" | "target" | "confirmed" | "note">): Promise<TOut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await setPolicy(getPool(), s, p); } catch { return FAILED; }
}
export async function previewSelectionAction(sel: string[]): Promise<{ add: string[]; remove: string[]; keep: string[] }> {
  const s = await getSession(); if (!s) return { add: [], remove: [], keep: [] };
  try { return await previewSelection(getPool(), s, sel); } catch { return { add: [], remove: [], keep: [] }; }
}
export async function activateAction(sel: string[], idempotencyKey: string, expectedVersion: number) {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.membershipId, "tpl", 20))) return { ok: false as const, error: TOO_FAST };
  try { const r = await activate(getPool(), s, sel, idempotencyKey, expectedVersion); if (r.ok) { revalidatePath("/templates"); revalidatePath("/setup"); } return r; } catch { return FAILED; }
}
export async function matchAction(input: MatchInput): Promise<{ ok: true; result: MatchResult } | { ok: false; error: string }> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return { ok: true, result: await matchTemplate(getPool(), s, input) }; } catch { return FAILED; }
}
export async function createFromTemplateAction(input: FromTemplateInput) {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.membershipId, "evt", 30))) return { ok: false as const, error: TOO_FAST };
  try { return await createEventFromTemplate(getPool(), s, input); } catch { return { ok: false as const, error: "The event could not be saved. Try again." }; }
}
export async function saveInputsAction(eventId: string, inputs: TemplateInputs, values: Record<string, unknown>): Promise<TOut<{ schedule: Schedule }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { const r = await updateTemplateInputs(getPool(), s, eventId, inputs, values); if (r.ok) revalidatePath(`/events/${eventId}`); return r; } catch { return FAILED; }
}

import { removeOverride, rollbackTo } from "@/templates/lifecycle";
import { addOverride, listLibrary, type OverrideInput } from "@/templates/service";
export async function adoptAction(keys: string[], idempotencyKey: string, expectedVersion: number) {
  const s = await getSession(); if (!s) return NO_SESSION;
  try {
    const enabled = (await listLibrary(getPool(), s)).filter((t) => t.enabled).map((t) => t.key);
    const r = await activate(getPool(), s, enabled, idempotencyKey, expectedVersion, "Adopted template updates", keys);
    if (r.ok) revalidatePath("/templates");
    return r;
  } catch { return FAILED; }
}
export async function rollbackAction(version: number, idempotencyKey: string, expectedVersion: number) {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { const r = await rollbackTo(getPool(), s, version, idempotencyKey, expectedVersion); if (r.ok) revalidatePath("/templates"); return r; } catch { return FAILED; }
}
export async function addOverrideAction(input: OverrideInput) {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await addOverride(getPool(), s, input); } catch { return FAILED; }
}
export async function removeOverrideAction(id: string) {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await removeOverride(getPool(), s, id); } catch { return FAILED; }
}
export async function applyConfigAction(idempotencyKey: string, expectedVersion: number) {
  const s = await getSession(); if (!s) return NO_SESSION;
  try {
    const enabled = (await listLibrary(getPool(), s)).filter((t) => t.enabled).map((t) => t.key);
    const r = await activate(getPool(), s, enabled, idempotencyKey, expectedVersion, "Applied template customisations");
    if (r.ok) revalidatePath("/templates");
    return r;
  } catch { return FAILED; }
}

import { cloneTemplate, saveCompanyTemplate, type CustomMeta } from "@/templates/custom";
export async function cloneTemplateAction(fromKey: string, meta: CustomMeta) {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.membershipId, "tpl", 20))) return { ok: false as const, error: TOO_FAST };
  try { const r = await cloneTemplate(getPool(), s, fromKey, meta); if (r.ok) revalidatePath("/templates"); return r; } catch { return FAILED; }
}
export async function importTemplateAction(meta: CustomMeta, json: string) {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.membershipId, "tpl", 20))) return { ok: false as const, error: TOO_FAST };
  if (json.length > 250_000) return { ok: false as const, error: "The template is too large." };
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return { ok: false as const, error: "That file is not valid JSON." }; }
  const content = raw && typeof raw === "object" && "content" in raw ? (raw as { content: unknown }).content : raw;
  try { const r = await saveCompanyTemplate(getPool(), s, meta, content, "Imported"); if (r.ok) revalidatePath("/templates"); return r; } catch { return FAILED; }
}

import { recommendationGap, type Gap } from "@/templates/service";
export async function recommendationGapAction(): Promise<Gap | null> {
  const s = await getSession(); if (!s) return null;
  try { return await recommendationGap(getPool(), s); } catch { return null; }
}
