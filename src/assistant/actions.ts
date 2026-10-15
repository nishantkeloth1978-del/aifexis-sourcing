import type { Pool } from "pg";
import { withTenant } from "@/authz";
import { can } from "@/access/permissions";
import { rateLimit } from "@/lib/ratelimit";
import { addItem, createEvent, duplicateEvent, getEvent, listEvents, updateEventBasics, validate, validateItem, type Who } from "@/events/service";

/**
 * Changes the assistant may PREPARE. It never runs them: a proposal is stored, shown to the person as a card with the exact details, and runs only when
 * that same person presses Confirm (single use, 15 minutes). Every change goes through the same service functions as the screens, so permissions,
 * "draft only" rules and the audit trail are unchanged. Deliberately not here: publish, invite, approve, award, cancel, delete.
 */
export const ACTION_KINDS = ["create_event", "update_event", "duplicate_event", "add_item"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export interface Summary { title: string; rows: [string, string][] }
export interface ProposalOut { id: string; kind: ActionKind; summary: Summary }

export const A_NO_PERM = "Your role cannot create or edit events.";
export const A_GONE = "This request has expired or was already handled.";
export const A_FAST = "Too many requests. Wait a moment and try again.";
export const A_CANCELLED = "Cancelled. Nothing was changed.";
export const A_FAILED = "That change could not be made. Nothing was changed.";
export const A_DONE_CREATE = "Event created as a draft.";
export const A_DONE_UPDATE = "Event updated.";
export const A_DONE_COPY = "Event copied as a new draft.";
export const A_DONE_ITEM = "Item added.";
// Notes handed to the model (never shown to people).
export const NOTE_FAILED = "That change could not be prepared.";
export const NOTE_ONE = "Only one change can be prepared per reply. Tell the person to ask for the next one after this is decided.";
export const NOTE_PREPARED = "The person now sees a card with the details and Confirm and Cancel buttons. Nothing has been changed yet. Say briefly what you prepared and ask them to confirm.";
export const ACTION_MESSAGES = [A_NO_PERM, A_GONE, A_FAST, A_CANCELLED, A_FAILED, A_DONE_CREATE, A_DONE_UPDATE, A_DONE_COPY, A_DONE_ITEM];
export const SUMMARY_WORDS = ["Create a new event", "Change a draft event", "Copy an event", "Add an item to a draft event", "Event", "Title", "Department", "Closing date", "Description", "Quantity", "Unit", "(not set)"];

export const ACTION_TOOL = {
  name: "propose_action",
  description: "Prepare ONE change for the person to confirm. Nothing happens until they press Confirm on a card that shows the exact details, so use it when they ask you to do something. Kinds: create_event (new blank draft: title, optional department and closing_date), update_event (change title, department or closing_date of a DRAFT event, by ref), duplicate_event (copy an event by ref as a new draft), add_item (add one line to a DRAFT event by ref: description, quantity, unit). Cannot publish, invite suppliers, approve, award, cancel or delete.",
  input_schema: { type: "object", properties: {
    kind: { type: "string", enum: [...ACTION_KINDS] },
    ref: { type: "string", description: "Event reference such as EV-2026-014 (not for create_event)." },
    title: { type: "string" }, department: { type: "string" },
    closing_date: { type: "string", description: "A date (YYYY-MM-DD, taken as 17:00 Gulf time) or a full ISO date-time." },
    description: { type: "string" }, quantity: { type: "string" }, unit: { type: "string", description: "For example EA, M, KG, HR." } }, required: ["kind"] },
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const show = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "(not set)");

/** A date alone means the end of the working day in the Gulf (17:00, UTC+4); anything else must be a valid date-time. */
export function parseClosing(raw: string): { ok: true; iso: string } | { ok: false } {
  if (!raw) return { ok: false };
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T13:00:00Z`) : new Date(raw);
  return Number.isNaN(d.getTime()) ? { ok: false } : { ok: true, iso: d.toISOString() };
}

async function findDraft(pool: Pool, who: Who, ref: string) {
  const r = ref.toUpperCase();
  const hit = (await listEvents(pool, who, 1000)).find((e) => (e.ref ?? "").toUpperCase() === r);
  return hit ?? null;
}

export type ProposeResult = { ok: true; proposal: ProposalOut } | { ok: false; note: string };

export async function proposeAction(pool: Pool, who: Who, input: unknown): Promise<ProposeResult> {
  const a = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const kind = a.kind as ActionKind;
  if (!ACTION_KINDS.includes(kind)) return { ok: false, note: "Unknown kind of change. The assistant can only prepare create_event, update_event, duplicate_event and add_item." };
  if (!can(who, "event.create")) return { ok: false, note: A_NO_PERM };
  if (!(await rateLimit(pool, `assistant:prop:${who.membershipId}`, 3600, 20))) return { ok: false, note: A_FAST };

  const title = str(a.title, 200), dept = str(a.department, 100), closing = str(a.closing_date, 40), ref = str(a.ref, 30);
  let params: Record<string, unknown>, summary: Summary;

  if (kind === "create_event") {
    const c = closing ? parseClosing(closing) : null;
    if (c && !c.ok) return { ok: false, note: "The closing date is not valid. Ask for a date such as 2026-11-30." };
    const v = validate({ title, ownerDept: dept, closesAt: c?.ok ? c.iso : undefined });
    if (!v.ok) return { ok: false, note: v.error };
    params = { title: v.value.title, department: v.value.ownerDept, closesAt: v.value.closesAt };
    summary = { title: "Create a new event", rows: [["Title", v.value.title], ["Department", v.value.ownerDept || "(not set)"], ["Closing date", show(v.value.closesAt)]] };
  } else {
    const hit = await findDraft(pool, who, ref);
    if (!hit) return { ok: false, note: "No event with that reference that this person can see." };
    if (kind === "duplicate_event") {
      params = { eventId: hit.id };
      summary = { title: "Copy an event", rows: [["Event", `${hit.ref} ${hit.title}`.slice(0, 160)]] };
    } else if (hit.state !== "draft") {
      return { ok: false, note: "That event is no longer a draft, so it cannot be changed. Suggest the person uses the event page." };
    } else if (kind === "update_event") {
      const c = closing ? parseClosing(closing) : null;
      if (c && !c.ok) return { ok: false, note: "The closing date is not valid. Ask for a date such as 2026-11-30." };
      if (!title && !dept && !closing) return { ok: false, note: "Nothing to change. Ask what to change: title, department or closing date." };
      const v = validate({ title: title || hit.title, ownerDept: dept || hit.ownerDept, closesAt: c?.ok ? c.iso : (hit.closesAt ?? undefined) });
      if (!v.ok) return { ok: false, note: v.error };
      params = { eventId: hit.id, ...(title ? { title } : {}), ...(dept ? { department: dept } : {}), ...(c?.ok ? { closesAt: c.iso } : {}) };
      const rows: [string, string][] = [["Event", `${hit.ref} ${hit.title}`.slice(0, 160)]];
      if (title) rows.push(["Title", title]);
      if (dept) rows.push(["Department", dept]);
      if (c?.ok) rows.push(["Closing date", `${show(hit.closesAt)} → ${show(c.iso)}`]);
      summary = { title: "Change a draft event", rows };
    } else {
      const description = str(a.description, 400), quantity = str(a.quantity, 30), unit = str(a.unit, 20);
      const v = validateItem({ description, quantity, unit });
      if (!v.ok) return { ok: false, note: v.error };
      params = { eventId: hit.id, description: v.value.description, quantity: v.value.quantity, unit: v.value.unit };
      summary = { title: "Add an item to a draft event", rows: [["Event", `${hit.ref} ${hit.title}`.slice(0, 160)], ["Description", v.value.description], ["Quantity", v.value.quantity], ["Unit", v.value.unit]] };
    }
  }

  const id = (await withTenant(pool, who.tenantId, (c) => c.query(
    `insert into assistant_action (tenant_id, membership_id, kind, params, summary) values ($1,$2,$3,$4,$5) returning id`,
    [who.tenantId, who.membershipId, kind, JSON.stringify(params), JSON.stringify(summary)]))).rows[0].id as string;
  return { ok: true, proposal: { id, kind, summary } };
}

export type ResolveResult = { ok: true; message: string; link?: string } | { ok: false; error: string };

/** The person's decision on a proposal. Confirm runs it once, as that person; cancel and expiry change nothing. */
export async function resolveAction(pool: Pool, who: Who, id: string, decision: "confirm" | "cancel"): Promise<ResolveResult> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: A_GONE };
  if (!(await rateLimit(pool, `assistant:act:${who.membershipId}`, 60, 30))) return { ok: false, error: A_FAST };
  if (decision === "cancel") {
    const n = await withTenant(pool, who.tenantId, async (c) => (await c.query(`update assistant_action set status = 'cancelled', decided_at = now() where id = $1 and membership_id = $2 and status = 'proposed'`, [id, who.membershipId])).rowCount);
    return n ? { ok: true, message: A_CANCELLED } : { ok: false, error: A_GONE };
  }
  const claimed = await withTenant(pool, who.tenantId, async (c) => (await c.query(
    `update assistant_action set status = 'running', decided_at = now()
      where id = $1 and membership_id = $2 and status = 'proposed' and created_at > now() - interval '15 minutes' returning kind, params`, [id, who.membershipId])).rows[0] as { kind: ActionKind; params: Record<string, string> } | undefined);
  if (!claimed) return { ok: false, error: A_GONE };

  const finish = (status: "done" | "failed", result: string) => withTenant(pool, who.tenantId, (c) => c.query(`update assistant_action set status = $3, result = $4 where id = $1 and membership_id = $2`, [id, who.membershipId, status, result.slice(0, 300)])).catch(() => undefined);
  const p = claimed.params;
  try {
    let out: ResolveResult;
    if (claimed.kind === "create_event") {
      const r = await createEvent(pool, who, { title: p.title!, ownerDept: p.department || undefined, closesAt: p.closesAt || undefined });
      out = r.ok ? { ok: true, message: A_DONE_CREATE, link: `/events/${r.event.id}` } : { ok: false, error: r.error };
    } else if (claimed.kind === "duplicate_event") {
      const r = await duplicateEvent(pool, who, p.eventId!);
      out = r.ok ? { ok: true, message: A_DONE_COPY, link: `/events/${r.id}` } : { ok: false, error: r.error };
    } else if (claimed.kind === "update_event") {
      const cur = await getEvent(pool, who, p.eventId!);
      if (!cur) out = { ok: false, error: A_FAILED };
      else {
        const r = await updateEventBasics(pool, who, cur.id, { title: p.title ?? cur.title, ownerDept: p.department ?? cur.ownerDept, closesAt: p.closesAt ?? cur.closesAt ?? undefined });
        out = r.ok ? { ok: true, message: A_DONE_UPDATE, link: `/events/${cur.id}` } : { ok: false, error: r.error };
      }
    } else {
      const r = await addItem(pool, who, p.eventId!, { description: p.description!, quantity: p.quantity!, unit: p.unit! });
      out = r.ok ? { ok: true, message: A_DONE_ITEM, link: `/events/${p.eventId}` } : { ok: false, error: r.error };
    }
    await finish(out.ok ? "done" : "failed", out.ok ? out.message : out.error);
    return out;
  } catch (e) {
    if (process.env.ASSISTANT_DEBUG) console.error("[assistant] action failed", claimed.kind, e);
    await finish("failed", "error");
    return { ok: false, error: A_FAILED };
  }
}
