"use server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { createEvent, createFromTemplate, type CreateInput, type CreateResult } from "@/events/service";

/** Saves a new draft event for the signed-in person's tenant. The screen shows it immediately; this confirms it. */
export async function createEventAction(input: CreateInput): Promise<CreateResult> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Your session has ended. Sign in again." };
  try {
    return await createEvent(getPool(), s, input);
  } catch {
    return { ok: false, error: "The event could not be saved. Try again." };
  }
}

export async function createFromTemplateAction(templateId: string, input: CreateInput): Promise<CreateResult> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Your session has ended. Sign in again." };
  try { return await createFromTemplate(getPool(), s, templateId, input); } catch { return { ok: false, error: "The event could not be saved. Try again." }; }
}
