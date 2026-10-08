"use server";
import { getPool } from "@/lib/db";
import { withinRate } from "@/lib/guard";
import { TOO_FAST } from "@/lib/ratelimit";
import { getSupplierSession } from "@/lib/session";
import { submitBidForm, type BidOut } from "@/bids/service";

export async function submitBidAction(eventId: string, input: { prices: Record<string, string>; technicalText: string; gates?: Record<string, boolean>; answers?: Record<string, unknown>; idempotencyKey: string }): Promise<BidOut<{ revisionNo: number; total: string }>> {
  const who = await getSupplierSession();
  if (!who) return { ok: false, error: "Your session has ended. Sign in again." };
  if (!(await withinRate(who.supplierUserId, "bid", 30))) return { ok: false, error: TOO_FAST };
  try { return await submitBidForm(getPool(), who, eventId, input); } catch { return { ok: false, error: "That could not be submitted. Try again." }; }
}

import { askQuestion } from "@/clarifications/service";
export async function askQuestionAction(eventId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const who = await getSupplierSession();
  if (!who) return { ok: false, error: "Your session has ended. Sign in again." };
  try { return await askQuestion(getPool(), who, eventId, text); } catch { return { ok: false, error: "That could not be sent. Try again." }; }
}

import { deleteSupplierFile, uploadBidAttachment } from "@/files/service";
export async function uploadAttachmentAction(eventId: string, form: FormData): Promise<{ ok: boolean; error?: string }> {
  const who = await getSupplierSession();
  if (!who) return { ok: false, error: "Your session has ended. Sign in again." };
  if (!(await withinRate(who.supplierUserId, "up", 20))) return { ok: false, error: TOO_FAST };
  const f = form.get("file");
  if (!(f instanceof File)) return { ok: false, error: "Choose a file." };
  try { return await uploadBidAttachment(getPool(), who, eventId, f.name, Buffer.from(await f.arrayBuffer())); } catch { return { ok: false, error: "That could not be uploaded. Try again." }; }
}
export async function deleteAttachmentAction(eventId: string, fileId: string): Promise<{ ok: boolean; error?: string }> {
  const who = await getSupplierSession();
  if (!who) return { ok: false, error: "Your session has ended. Sign in again." };
  try { return await deleteSupplierFile(getPool(), who, eventId, fileId); } catch { return { ok: false, error: "That could not be removed. Try again." }; }
}

import { parsePriceSheet, type PriceSheetResult } from "@/bids/sheet";
import { getBidForm } from "@/bids/service";
export async function importPricesAction(eventId: string, form: FormData): Promise<({ ok: true } & PriceSheetResult) | { ok: false; error: string }> {
  const who = await getSupplierSession();
  if (!who) return { ok: false, error: "Your session has ended. Sign in again." };
  if (!(await withinRate(who.supplierUserId, "up", 20))) return { ok: false, error: TOO_FAST };
  const f = form.get("file");
  if (!(f instanceof File)) return { ok: false, error: "Choose a file." };
  if (f.size > 2_000_000) return { ok: false, error: "The file is too large." };
  try {
    const bf = await getBidForm(getPool(), who, eventId);
    if (!bf) return { ok: false, error: "This event is not available to you." };
    const r = await parsePriceSheet(f.name, Buffer.from(await f.arrayBuffer()), bf.items);
    return "fatal" in r ? { ok: false, error: r.fatal } : { ok: true, ...r };
  } catch { return { ok: false, error: "That file could not be read." }; }
}
