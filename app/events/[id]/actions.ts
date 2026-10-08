"use server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { withinRate } from "@/lib/guard";
import { TOO_FAST } from "@/lib/ratelimit";
import { addLot, deleteLot, setItemLot, type Lot, type LResult } from "@/lots/service";
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
export async function addLotAction(eventId: string, name: string): Promise<LResult<{ lot: Lot }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await addLot(getPool(), s, eventId, name); } catch { return FAILED; }
}
export async function deleteLotAction(eventId: string, lotId: string): Promise<LResult> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await deleteLot(getPool(), s, eventId, lotId); } catch { return FAILED; }
}
export async function setItemLotAction(eventId: string, itemId: string, lotId: string | null): Promise<LResult> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await setItemLot(getPool(), s, eventId, itemId, lotId); } catch { return FAILED; }
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
export async function recommendAction(eventId: string, version: number, supplierId: string | Record<string, string>, note: string): Promise<ComOut> {
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

import { deleteTenderDocument, uploadTenderDocument } from "@/files/service";
export async function uploadTenderAction(eventId: string, form: FormData): Promise<{ ok: boolean; error?: string }> {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.membershipId, "up", 20))) return { ok: false, error: TOO_FAST };
  const f = form.get("file");
  if (!(f instanceof File)) return { ok: false, error: "Choose a file." };
  try { return await uploadTenderDocument(getPool(), s, eventId, f.name, Buffer.from(await f.arrayBuffer())); } catch { return FAILED; }
}
export async function deleteTenderAction(eventId: string, fileId: string): Promise<{ ok: boolean; error?: string }> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await deleteTenderDocument(getPool(), s, eventId, fileId); } catch { return FAILED; }
}

import { duplicateEvent, importItems, type ImportRow } from "@/events/service";
import { parseItemsSheet } from "@/events/sheet";
import { fillFromCatalog } from "@/catalog/fill";
import { withTenant } from "@/authz";
import { redirect } from "next/navigation";

export async function previewItemsAction(form: FormData): Promise<{ ok: true; rows: ImportRow[]; errors: { row: number; message: string }[]; total: number } | { ok: false; error: string }> {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.membershipId, "up", 20))) return { ok: false, error: TOO_FAST };
  const f = form.get("file");
  if (!(f instanceof File)) return { ok: false, error: "Choose a file." };
  if (f.size > 2 * 1024 * 1024) return { ok: false, error: "The file is larger than 2 MB." };
  try {
    const r = await parseItemsSheet(f.name, Buffer.from(await f.arrayBuffer()));
    if ("fatal" in r) return { ok: false, error: r.fatal };
    const filled = await withTenant(getPool(), s.tenantId, (c) => fillFromCatalog(c, r.rows));
    const bad = new Set(filled.unknown.map((u) => u.rowNo));
    const errors = [...r.errors, ...filled.unknown.map((u) => ({ row: u.rowNo ?? 0, message: `The code ${u.code} is not in the item catalogue.` }))].sort((a, b) => a.row - b.row);
    return { ok: true, rows: filled.rows.filter((x) => !bad.has(x.rowNo)), errors, total: r.total };
  } catch { return { ok: false, error: "That file could not be read." }; }
}
export async function importItemsAction(eventId: string, rows: ImportRow[]): Promise<{ ok: boolean; error?: string; added?: number }> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await importItems(getPool(), s, eventId, rows); } catch { return FAILED; }
}
export async function duplicateEventAction(eventId: string): Promise<{ ok: false; error: string } | never> {
  const s = await getSession(); if (!s) return NO_SESSION;
  let id: string;
  try { const r = await duplicateEvent(getPool(), s, eventId); if (!r.ok) return r; id = r.id; } catch { return FAILED; }
  redirect(`/events/${id}`);
}

import { deleteTemplate, saveAsTemplate } from "@/events/service";
export async function saveTemplateAction(eventId: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await saveAsTemplate(getPool(), s, eventId, name); } catch { return FAILED; }
}
export async function deleteTemplateAction(templateId: string): Promise<{ ok: boolean; error?: string }> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await deleteTemplate(getPool(), s, templateId); } catch { return FAILED; }
}
