"use server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
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
export async function updateBasicsAction(eventId: string, input: CreateInput): Promise<Result<{ event: EventSummary }>> {
  const s = await getSession(); if (!s) return NO_SESSION;
  try { return await updateEventBasics(getPool(), s, eventId, input); } catch { return FAILED; }
}
