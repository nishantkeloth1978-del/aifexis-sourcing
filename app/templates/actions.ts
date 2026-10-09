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

import { checkContent, rawTemplate } from "@/templates/custom";
import { parseTemplateWorkbook, placeOf, templateWorkbook } from "@/templates/sheet";
import type { Issue } from "@/templates/validate";
import type { TemplateContent } from "@/templates/types";

export async function checkTemplateAction(content: unknown): Promise<{ ok: boolean; issues: { key: string; message: string; remediation?: string }[] }> {
  const s = await getSession(); if (!s) return { ok: false, issues: [{ key: "", message: "Your session has ended. Sign in again." }] };
  const r = checkContent(content);
  return r.ok ? { ok: true, issues: [] } : { ok: false, issues: r.issues.map((i: Issue) => ({ key: i.key, message: i.message, ...(i.remediation ? { remediation: i.remediation } : {}) })) };
}
export async function exportSheetAction(meta: CustomMeta, content: unknown): Promise<{ ok: true; base64: string } | { ok: false; error: string }> {
  const s = await getSession(); if (!s || s.role !== "admin") return { ok: false, error: "Only an administrator can customise templates." };
  const c = checkContent(content);
  if (!c.ok) return { ok: false, error: "Fix the problems shown before downloading the spreadsheet." };
  return { ok: true, base64: (await templateWorkbook(meta, c.content)).toString("base64") };
}
export interface SheetPreview { meta: Partial<CustomMeta>; content: TemplateContent | null; counts: Record<string, number>; problems: { where: string; message: string }[] }
export async function previewSheetAction(form: FormData): Promise<{ ok: true; preview: SheetPreview } | { ok: false; error: string }> {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (s.role !== "admin") return { ok: false, error: "Only an administrator can customise templates." };
  if (!(await withinRate(s.membershipId, "up", 20))) return { ok: false, error: TOO_FAST };
  const f = form.get("file");
  if (!(f instanceof File)) return { ok: false, error: "Choose a file." };
  if (f.size > 2 * 1024 * 1024) return { ok: false, error: "The file is larger than 2 MB." };
  try {
    const p = await parseTemplateWorkbook(f.name, Buffer.from(await f.arrayBuffer()));
    if ("fatal" in p) return { ok: false, error: p.fatal };
    const where = (path: string) => { const x = placeOf(path, p.rowMap); return x ? `${x.sheet} row ${x.row}` : path; };
    const problems = p.problems.map((x) => ({ where: x.row ? `${x.sheet} row ${x.row}` : x.sheet, message: x.message }));
    const c = checkContent(p.raw);
    if (!c.ok) for (const i of c.issues) problems.push({ where: where(i.key), message: i.message });
    const raw = p.raw as { fields: unknown[]; questions: unknown[]; documents: unknown[]; pricing: { lines: unknown[]; groups: unknown[] } };
    return { ok: true, preview: { meta: p.meta, content: c.ok && problems.length === 0 ? c.content : null, problems: problems.slice(0, 30),
      counts: { fields: raw.fields.length, questions: raw.questions.length, documents: raw.documents.length, groups: raw.pricing.groups.length, lines: raw.pricing.lines.length } } };
  } catch { return { ok: false, error: "That file could not be read." }; }
}
export async function loadTemplateAction(key: string) {
  const s = await getSession(); if (!s) return null;
  return rawTemplate(getPool(), s, key);
}

import { draftTemplate, type DraftOut } from "@/templates/ai";
import { listCategories as listCats } from "@/templates/service";
import { allow as allowRate } from "@/lib/ratelimit";

/** Asks the model for a draft. Administrators only, limited per person per hour. Saves nothing: the editor shows the draft for review. */
export async function draftTemplateAction(brief: string): Promise<DraftOut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (s.role !== "admin") return { ok: false, error: "Only an administrator can customise templates." };
  if (!(await allowRate(getPool(), [[`aidraft:${s.membershipId}`, 3600, 10]]))) return { ok: false, error: "You have reached the limit of AI drafts for this hour. Try again later." };
  try {
    const cats = (await listCats(getPool(), s)).map((c) => ({ code: c.code, label: c.en }));
    return await draftTemplate(brief, cats);
  } catch { return FAILED; }
}

import { setDefault } from "@/templates/defaults";
export async function setDefaultAction(eventType: string, category: string | null, templateKey: string | null): Promise<TOut> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { const r = await setDefault(getPool(), s, eventType, category, templateKey); if (r.ok) revalidatePath("/templates"); return r; } catch { return FAILED; }
}
