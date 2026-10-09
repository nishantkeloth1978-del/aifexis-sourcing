"use server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { withinRate } from "@/lib/guard";
import { TOO_FAST } from "@/lib/ratelimit";
import { addNote, draftAnswer, responseReport, translateText, type TranslateSource, answerBoard, assignQuestion, markSeen, mergeThreads, publishBoard, reclassify, sendNotice, setDeadlines, staffOverview, staffReply, suggestPublic, type Decision, type FileIn, type MOut, type Overview } from "@/messages/service";

const NO_SESSION = { ok: false as const, error: "Your session has ended. Sign in again." };
const FAILED = { ok: false as const, error: "That could not be saved. Try again." };
async function filesOf(fd: FormData): Promise<FileIn[]> {
  const out: FileIn[] = [];
  for (const f of fd.getAll("file")) if (f instanceof File && f.size > 0) out.push({ filename: f.name, bytes: Buffer.from(await f.arrayBuffer()) });
  return out;
}
async function run<T>(fn: (s: NonNullable<Awaited<ReturnType<typeof getSession>>>) => Promise<T>): Promise<T | typeof NO_SESSION | typeof FAILED> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await fn(s); } catch { return FAILED; }
}

export async function pollMessagesAction(eventId: string): Promise<{ ok: true; overview: Overview } | { ok: false; error: string }> {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.userId, "msgpoll", 600))) return { ok: false, error: TOO_FAST };
  try { const o = await staffOverview(getPool(), s, eventId); return o ? { ok: true, overview: o } : { ok: false, error: "This event is not available to you." }; } catch { return FAILED; }
}
export const markSeenAction = async (eventId: string, lane: "board" | "private" | "notice") => run((s) => markSeen(getPool(), s, eventId, lane));
export const setDeadlinesAction = async (eventId: string, qd: string | null, lad: string | null) => run((s) => setDeadlines(getPool(), s, eventId, { questionDeadline: qd, lastAnswerDate: lad }));
export const assignAction = async (eventId: string, threadId: string, membershipId: string | null, dueAt: string | null) => run((s) => assignQuestion(getPool(), s, eventId, threadId, membershipId, dueAt));
export const noteAction = async (eventId: string, threadId: string, text: string) => run((s) => addNote(getPool(), s, eventId, threadId, text));
export const reclassifyAction = async (eventId: string, threadId: string) => run((s) => reclassify(getPool(), s, eventId, threadId));
export const mergeAction = async (eventId: string, threadId: string, intoId: string) => run((s) => mergeThreads(getPool(), s, eventId, threadId, intoId));
export const suggestAction = async (eventId: string, threadId: string) => run((s) => suggestPublic(getPool(), s, eventId, threadId));
export const publishAction = async (eventId: string, threadId: string, input: { publicQuestion: string; publicAnswer: string; scopeChange?: boolean }) => run((s) => publishBoard(getPool(), s, eventId, threadId, input));
export async function answerMessageAction(eventId: string, threadId: string, fd: FormData): Promise<MOut> {
  return run(async (s) => answerBoard(getPool(), s, eventId, threadId, String(fd.get("text") ?? ""), await filesOf(fd))) as Promise<MOut>;
}
export async function replyAction(eventId: string, supplierId: string, fd: FormData, decision?: Decision, requestDueAt?: string | null): Promise<MOut<{ id: string }>> {
  return run(async (s) => {
    if (!(await withinRate(s.userId, "msg", 60))) return { ok: false as const, error: TOO_FAST };
    return staffReply(getPool(), s, eventId, supplierId, String(fd.get("text") ?? ""), { files: await filesOf(fd), decision, requestDueAt });
  }) as Promise<MOut<{ id: string }>>;
}
export async function noticeAction(eventId: string, fd: FormData): Promise<MOut<{ id: string }>> {
  return run(async (s) => sendNotice(getPool(), s, eventId, String(fd.get("text") ?? ""), await filesOf(fd))) as Promise<MOut<{ id: string }>>;
}

export async function draftAction(eventId: string, threadId: string): Promise<MOut<{ draft: string }>> {
  return run(async (s) => {
    if (!(await withinRate(s.userId, "msgai", 20))) return { ok: false as const, error: TOO_FAST };
    return draftAnswer(getPool(), s, eventId, threadId);
  }) as Promise<MOut<{ draft: string }>>;
}
export async function translateStaffAction(eventId: string, source: TranslateSource, lang: "en" | "ar"): Promise<MOut<{ text: string }>> {
  return run(async (s) => {
    if (!(await withinRate(s.userId, "msgai", 20))) return { ok: false as const, error: TOO_FAST };
    return translateText(getPool(), { staff: s }, eventId, source, lang);
  }) as Promise<MOut<{ text: string }>>;
}
export const reportAction = async (eventId: string) => run((s) => responseReport(getPool(), s, eventId));
