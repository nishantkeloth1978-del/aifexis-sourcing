"use server";
import { getPool } from "@/lib/db";
import { getSupplierSession } from "@/lib/session";
import { withinRate } from "@/lib/guard";
import { TOO_FAST } from "@/lib/ratelimit";
import { acknowledgeNotice, translateText, type TranslateSource, askBoard, markSeen, supplierOverview, supplierSend, withdrawQuestion, type FileIn, type MOut, type Overview } from "@/messages/service";

const NO_SESSION = { ok: false as const, error: "Your session has ended. Sign in again." };
const FAILED = { ok: false as const, error: "That could not be sent. Try again." };
async function filesOf(fd: FormData): Promise<FileIn[]> {
  const out: FileIn[] = [];
  for (const f of fd.getAll("file")) if (f instanceof File && f.size > 0) out.push({ filename: f.name, bytes: Buffer.from(await f.arrayBuffer()) });
  return out;
}

export async function pollSupplierMessagesAction(eventId: string): Promise<{ ok: true; overview: Overview } | { ok: false; error: string }> {
  const who = await getSupplierSession(); if (!who) return NO_SESSION;
  if (!(await withinRate(who.supplierUserId, "msgpoll", 600))) return { ok: false, error: TOO_FAST };
  try { const o = await supplierOverview(getPool(), who, eventId); return o ? { ok: true, overview: o } : { ok: false, error: "This event is not available to you." }; } catch { return FAILED; }
}
export async function supplierSeenAction(eventId: string, lane: "board" | "private" | "notice"): Promise<MOut> {
  const who = await getSupplierSession(); if (!who) return NO_SESSION;
  try { return await markSeen(getPool(), who, eventId, lane); } catch { return FAILED; }
}
export async function askBoardAction(eventId: string, fd: FormData): Promise<MOut<{ id: string }>> {
  const who = await getSupplierSession(); if (!who) return NO_SESSION;
  if (!(await withinRate(who.supplierUserId, "msg", 30))) return { ok: false, error: TOO_FAST };
  try {
    return await askBoard(getPool(), who, eventId, { text: String(fd.get("text") ?? ""), anchorItemId: String(fd.get("anchor") ?? "") || null, confidential: fd.get("confidential") === "on", reason: String(fd.get("reason") ?? "") }, await filesOf(fd));
  } catch { return FAILED; }
}
export async function withdrawAction(eventId: string, threadId: string): Promise<MOut> {
  const who = await getSupplierSession(); if (!who) return NO_SESSION;
  try { return await withdrawQuestion(getPool(), who, eventId, threadId); } catch { return FAILED; }
}
export async function supplierSendAction(eventId: string, fd: FormData): Promise<MOut<{ id: string }>> {
  const who = await getSupplierSession(); if (!who) return NO_SESSION;
  if (!(await withinRate(who.supplierUserId, "msg", 30))) return { ok: false, error: TOO_FAST };
  try { return await supplierSend(getPool(), who, eventId, String(fd.get("text") ?? ""), await filesOf(fd)); } catch { return FAILED; }
}
export async function ackAction(eventId: string, messageId: string): Promise<MOut> {
  const who = await getSupplierSession(); if (!who) return NO_SESSION;
  try { return await acknowledgeNotice(getPool(), who, eventId, messageId); } catch { return FAILED; }
}

export async function translateSupplierAction(eventId: string, source: TranslateSource, lang: "en" | "ar"): Promise<MOut<{ text: string }>> {
  const who = await getSupplierSession(); if (!who) return NO_SESSION;
  if (!(await withinRate(who.supplierUserId, "msgai", 20))) return { ok: false, error: TOO_FAST };
  try { return await translateText(getPool(), { supplier: who }, eventId, source, lang); } catch { return FAILED; }
}
