import type { Pool } from "pg";
import { audit, loadSubject, readClarifications, resolvePermitted, withTenant, type Actor } from "@/authz";
import type { Who } from "@/events/service";
import type { SupplierWho } from "@/suppliers/service";

export type ClarOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface Thread {
  id: string; question: string; asker: string | null;      // asker's company name is shown to staff only
  askedAt: string; answer: { body: string; shared: boolean; answeredAt: string } | null;
  fromOthers?: boolean;                                    // supplier view: a shared answer to somebody else's question
}

const supplierActor = (w: SupplierWho): Actor => ({ kind: "supplier", supplierUserId: w.supplierUserId, tenantId: w.tenantId });
const internal = (w: Who): Actor => ({ kind: "internal", userId: w.userId, tenantId: w.tenantId });

/** What a supplier sees: their own questions with answers, plus answers the buyer shared with everyone. */
export async function listForSupplier(pool: Pool, who: SupplierWho, eventId: string): Promise<Thread[]> {
  return withTenant(pool, who.tenantId, async (c) => {
    const rows = await readClarifications(c, supplierActor(who), eventId);
    const out: Thread[] = [];
    for (const q of rows.filter((r) => r.kind === "question" && r.supplier_id === who.supplierId)) {
      const a = rows.find((r) => r.kind === "answer" && r.parent_id === q.id);
      out.push({ id: q.id, question: q.body, asker: null, askedAt: new Date(q.created_at).toISOString(), answer: a ? { body: a.body, shared: a.visibility === "shared", answeredAt: new Date(a.created_at).toISOString() } : null });
    }
    for (const a of rows.filter((r) => r.kind === "answer" && r.visibility === "shared" && r.supplier_id !== who.supplierId)) {
      out.push({ id: a.id, question: a.question_text ?? "", asker: null, askedAt: new Date(a.created_at).toISOString(), answer: { body: a.body, shared: true, answeredAt: new Date(a.created_at).toISOString() }, fromOthers: true });
    }
    return out.sort((x, y) => x.askedAt.localeCompare(y.askedAt));
  });
}

export async function askQuestion(pool: Pool, who: SupplierWho, eventId: string, text: string): Promise<ClarOut<{ id: string }>> {
  const body = (text ?? "").trim();
  if (body.length < 5) return { ok: false, error: "Write your question (at least 5 characters)." };
  if (body.length > 2000) return { ok: false, error: "The question is too long (2,000 characters at most)." };
  return withTenant(pool, who.tenantId, async (c) => {
    const actor = supplierActor(who);
    const r = await resolvePermitted(c, actor, eventId);
    if (!r.ok) return { ok: false as const, error: "This event is not available to you." };
    if (r.event.state !== "published") return { ok: false as const, error: "Questions can only be asked while the event is open." };
    const id = (await c.query(`insert into clarification (tenant_id, event_id, supplier_id, visibility, kind, body) values ($1,$2,$3,'private','question',$4) returning id`, [who.tenantId, eventId, who.supplierId, body])).rows[0].id as string;
    await audit(c, actor, eventId, "clarification.asked", {});
    return { ok: true as const, id };
  });
}

/** What staff see: every question and its answer, with the asker's name for those allowed to read clarifications. */
export async function listForStaff(pool: Pool, who: Who, eventId: string): Promise<{ threads: Thread[]; canAnswer: boolean }> {
  return withTenant(pool, who.tenantId, async (c) => {
    const actor = internal(who);
    const rows = await readClarifications(c, actor, eventId);
    const subject = await loadSubject(c, who.userId, eventId);
    const names = new Map((await c.query(`select id, name from supplier_org`)).rows.map((r) => [r.id as string, r.name as string]));
    const threads: Thread[] = rows.filter((r) => r.kind === "question").map((q) => {
      const a = rows.find((r) => r.kind === "answer" && r.parent_id === q.id);
      return { id: q.id, question: q.body, asker: names.get(q.supplier_id) ?? null, askedAt: new Date(q.created_at).toISOString(),
        answer: a ? { body: a.body, shared: a.visibility === "shared", answeredAt: new Date(a.created_at).toISOString() } : null };
    });
    return { threads, canAnswer: subject.ownRoles.has("buyer") };
  });
}

export async function answerQuestion(pool: Pool, who: Who, eventId: string, questionId: string, text: string, share: boolean): Promise<ClarOut> {
  const body = (text ?? "").trim();
  if (body.length < 2) return { ok: false, error: "Write the answer." };
  if (body.length > 4000) return { ok: false, error: "The answer is too long (4,000 characters at most)." };
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state from sourcing_event where id = $1 for update`, [eventId])).rows[0];
    if (!ev) return { ok: false as const, error: "Event not found." };
    const subject = await loadSubject(c, who.userId, eventId);
    if (!subject.ownRoles.has("buyer")) return { ok: false as const, error: "Only the buyer of this event can answer questions." };
    if (ev.state !== "published") return { ok: false as const, error: "Questions can only be answered while the event is open." };
    const q = (await c.query(`select supplier_id, body from clarification where id = $1 and event_id = $2 and kind = 'question'`, [questionId, eventId])).rows[0];
    if (!q) return { ok: false as const, error: "Question not found." };
    if ((await c.query(`select 1 from clarification where parent_id = $1 and kind = 'answer'`, [questionId])).rowCount) return { ok: false as const, error: "That question has already been answered." };
    await c.query(`insert into clarification (tenant_id, event_id, supplier_id, visibility, kind, parent_id, body, question_text, author_membership_id) values ($1,$2,$3,$4,'answer',$5,$6,$7,$8)`,
      [who.tenantId, eventId, q.supplier_id, share ? "shared" : "private", questionId, body, share ? q.body : null, who.membershipId]);
    await audit(c, internal(who), eventId, "clarification.answered", { shared: share });
    return { ok: true as const };
  });
}
