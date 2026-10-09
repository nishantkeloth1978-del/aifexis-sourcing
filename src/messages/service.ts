import type { Pool, PoolClient } from "pg";
import { audit, loadSubject, resolvePermitted, withTenant, type Actor } from "@/authz";
import type { Who } from "@/events/service";
import type { SupplierWho } from "@/suppliers/service";
import { notify } from "@/notifications/hooks";
import { checkFile } from "@/files/service";
import { scanFile } from "@/files/scan";
import { looksLikeClarification, MAX_FILES, phaseOf, redact, rulesFor, supplierMayReply, type Phase, type Rules } from "./rules";

export interface Decision { share?: { publicQuestion: string; publicAnswer: string }; keepPrivateReason?: string }
export type MOut<T = object> = ({ ok: true } & T) | { ok: false; error: string; needsDecision?: { publicQuestion: string; publicAnswer: string } };
export interface FileIn { filename: string; bytes: Buffer }
export interface FileRef { id: string; filename: string; size: number }
export interface Msg { id: string; by: "supplier" | "staff" | "system"; byName: string | null; body: string; internal: boolean; at: string; files: FileRef[]; mine: boolean; unread: boolean; guardReason: string | null }
export interface BoardItem {
  id: string; anchorLabel: string | null; question: string; asker: string | null; mine: boolean; status: string; confidential: boolean; confidentialReason: string | null;
  assignee: { membershipId: string; email: string } | null; dueAt: string | null; overdue: boolean; published: boolean; publicQuestion: string | null; publicAnswer: string | null;
  scopeChange: boolean; mergedInto: string | null; createdAt: string; messages: Msg[]; unread: number;
}
export interface PrivateThread { id: string | null; supplierId: string; supplierName: string | null; messages: Msg[]; unread: number; requestDueAt: string | null; lastAt: string | null }
export interface Notice { id: string; body: string; at: string; files: FileRef[]; acknowledged: boolean; ackCount: number; total: number; pending: string[]; unread: boolean }
export interface Deadlines { closesAt: string | null; questionDeadline: string | null; lastAnswerDate: string | null }
export interface Overview {
  phase: Phase; rules: Rules; deadlines: Deadlines; board: BoardItem[]; threads: PrivateThread[]; notices: Notice[]; unread: { board: number; private: number; notice: number };
  canWrite: boolean; canReadPrivate: boolean; team: { membershipId: string; email: string }[]; items: { id: string; lineNo: number; description: string }[]; me: { membershipId: string | null };
}

const bad = (error: string) => ({ ok: false as const, error });
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const supplierActor = (w: SupplierWho): Actor => ({ kind: "supplier", supplierUserId: w.supplierUserId, tenantId: w.tenantId });
const internal = (w: Who): Actor => ({ kind: "internal", userId: w.userId, tenantId: w.tenantId });
const UUID = /^[0-9a-f-]{36}$/i;

// ---------- context ----------
interface Ev { state: string; ref: string; closesAt: Date | null; questionDeadline: Date | null; lastAnswerDate: Date | null }
async function loadEv(c: PoolClient, eventId: string): Promise<Ev | null> {
  if (!UUID.test(eventId)) return null;
  const r = (await c.query(`select state::text as state, ref, closes_at, question_deadline, last_answer_date from sourcing_event where id = $1`, [eventId])).rows[0];
  return r ? { state: r.state, ref: r.ref, closesAt: r.closes_at, questionDeadline: r.question_deadline, lastAnswerDate: r.last_answer_date } : null;
}
const deadlinesOf = (e: Ev): Deadlines => ({ closesAt: iso(e.closesAt), questionDeadline: iso(e.questionDeadline), lastAnswerDate: iso(e.lastAnswerDate) });

interface Staff { ev: Ev; phase: Phase; rules: Rules; writer: boolean; auditor: boolean; member: boolean; memberships: string[]; roles: Set<string> }
async function staffCtx(c: PoolClient, who: Who, eventId: string): Promise<Staff | null> {
  const ev = await loadEv(c, eventId); if (!ev) return null;
  const s = await loadSubject(c, who.userId, eventId);
  const roles = new Set<string>(s.effectiveRoles);
  if (roles.size === 0) return null;
  const phase = phaseOf(ev.state, ev.closesAt);
  return { ev, phase, rules: rulesFor(phase, { questionDeadline: ev.questionDeadline, lastAnswerDate: ev.lastAnswerDate }), writer: roles.has("buyer") || roles.has("requester"), auditor: roles.has("auditor"), member: true, memberships: s.membershipIds, roles };
}
interface Sup { ev: Ev; phase: Phase; rules: Rules; userId: string }
async function supCtx(c: PoolClient, who: SupplierWho, eventId: string): Promise<Sup | null> {
  const ev = await loadEv(c, eventId); if (!ev) return null;
  const r = await resolvePermitted(c, supplierActor(who), eventId);
  if (!r.ok) return null;
  const u = (await c.query(`select user_id from supplier_user where id = $1`, [who.supplierUserId])).rows[0];
  if (!u) return null;
  const phase = phaseOf(ev.state, ev.closesAt);
  return { ev, phase, rules: rulesFor(phase, { questionDeadline: ev.questionDeadline, lastAnswerDate: ev.lastAnswerDate }), userId: u.user_id };
}

// ---------- low level ----------
async function screen(files: FileIn[] | undefined): Promise<MOut<{ ok_files: { name: string; mime: string; bytes: Buffer }[] }>> {
  const out: { name: string; mime: string; bytes: Buffer }[] = [];
  if (!files?.length) return { ok: true, ok_files: out };
  if (files.length > MAX_FILES) return bad(`Attach at most ${MAX_FILES} files to one message.`);
  for (const f of files) {
    const chk = checkFile(f.filename, f.bytes); if (!chk.ok) return bad(chk.error);
    const sc = await scanFile(chk.name, f.bytes); if (!sc.ok) return bad(sc.error);
    out.push({ name: chk.name, mime: chk.mime, bytes: f.bytes });
  }
  return { ok: true, ok_files: out };
}

async function addMessage(c: PoolClient, a: { tenantId: string; threadId: string; eventId: string; kind: "supplier" | "staff" | "system"; userId: string | null; body: string; internal?: boolean; guardReason?: string | null; files?: { name: string; mime: string; bytes: Buffer }[] }): Promise<string> {
  const id = (await c.query(`insert into message (tenant_id, thread_id, event_id, author_kind, author_user_id, body, internal, guard_reason) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [a.tenantId, a.threadId, a.eventId, a.kind, a.userId, a.body.trim(), a.internal ?? false, a.guardReason ?? null])).rows[0].id as string;
  for (const f of a.files ?? []) await c.query(`insert into message_file (tenant_id, message_id, filename, mime, size_bytes, content) values ($1,$2,$3,$4,$5,$6)`, [a.tenantId, id, f.name, f.mime, f.bytes.length, f.bytes]);
  if (!a.internal) await c.query(`update message_thread set last_message_at = now() where id = $1`, [a.threadId]);
  return id;
}
const invitedUsers = async (c: PoolClient, eventId: string) =>
  (await c.query(`select distinct su.user_id from invitation i join supplier_user su on su.tenant_id = i.tenant_id and su.supplier_id = i.supplier_id where i.event_id = $1`, [eventId])).rows.map((r) => r.user_id as string);
const supplierUsers = async (c: PoolClient, supplierId: string) => (await c.query(`select user_id from supplier_user where supplier_id = $1`, [supplierId])).rows.map((r) => r.user_id as string);
const staffUsers = async (c: PoolClient, eventId: string, roles: string[]) =>
  (await c.query(`select distinct m.user_id from event_member em join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id where em.event_id = $1 and em.event_role = any($2)`, [eventId, roles])).rows.map((r) => r.user_id as string);
const allSupplierNames = async (c: PoolClient) => (await c.query(`select name from supplier_org`)).rows.map((r) => r.name as string);
const buyerRoles = ["buyer", "requester"];

async function threadOf(c: PoolClient, eventId: string, threadId: string, lane?: string) {
  if (!UUID.test(threadId)) return null;
  const t = (await c.query(`select * from message_thread where id = $1 and event_id = $2 ${lane ? "and lane = $3" : ""}`, lane ? [threadId, eventId, lane] : [threadId, eventId])).rows[0];
  return t ?? null;
}
const assigneeOk = (s: Staff, t: { assignee_membership_id: string | null }) => !!t.assignee_membership_id && s.memberships.includes(t.assignee_membership_id);

// ---------- overview ----------
function mapMsgs(rows: Record<string, unknown>[], files: Map<string, FileRef[]>, mineUser: string, names: Map<string, string>, readSet: Set<string>, showInternal: boolean): Map<string, Msg[]> {
  const out = new Map<string, Msg[]>();
  for (const m of rows) {
    if (m.internal && !showInternal) continue;
    const arr = out.get(m.thread_id as string) ?? [];
    arr.push({ id: m.id as string, by: m.author_kind as Msg["by"], byName: m.author_user_id ? names.get(m.author_user_id as string) ?? null : null, body: m.body as string, internal: m.internal as boolean, at: iso(m.created_at)!, files: files.get(m.id as string) ?? [],
      mine: m.author_user_id === mineUser, unread: m.author_user_id !== mineUser && !readSet.has(m.id as string), guardReason: (m.guard_reason as string | null) ?? null });
    out.set(m.thread_id as string, arr);
  }
  return out;
}
async function loadFiles(c: PoolClient, ids: string[]) {
  const map = new Map<string, FileRef[]>();
  if (!ids.length) return map;
  for (const f of (await c.query(`select id, message_id, filename, size_bytes from message_file where message_id = any($1::uuid[]) order by created_at`, [ids])).rows) {
    const a = map.get(f.message_id) ?? []; a.push({ id: f.id, filename: f.filename, size: f.size_bytes }); map.set(f.message_id, a);
  }
  return map;
}

export async function staffOverview(pool: Pool, who: Who, eventId: string): Promise<Overview | null> {
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await staffCtx(c, who, eventId); if (!s) return null;
    const readPrivate = s.writer || s.auditor;
    const threads = (await c.query(`select t.*, so.name as supplier_name from message_thread t left join supplier_org so on so.tenant_id = t.tenant_id and so.id = t.supplier_id where t.event_id = $1 order by t.created_at`, [eventId])).rows;
    const visible = threads.filter((t) => t.lane === "notice" || (t.lane === "board" && (s.writer || s.auditor || assigneeOk(s, t) || t.published_at)) || (t.lane === "private" && readPrivate));
    const msgs = visible.length ? (await c.query(`select * from message where thread_id = any($1::uuid[]) order by seq`, [visible.map((t) => t.id)])).rows : [];
    const files = await loadFiles(c, msgs.map((m) => m.id));
    const readSet = new Set((await c.query(`select message_id from message_receipt where user_id = $1`, [who.userId])).rows.map((r) => r.message_id as string));
    const names = new Map((await c.query(`select id, email from app_user where id = any($1::uuid[])`, [[...new Set(msgs.map((m) => m.author_user_id).filter(Boolean))]])).rows.map((r) => [r.id as string, r.email as string]));
    const byThread = new Map<string, Msg[]>();
    for (const t of visible) {
      const showInternal = s.writer || s.auditor || assigneeOk(s, t);
      const one = mapMsgs(msgs.filter((m) => m.thread_id === t.id), files, who.userId, names, readSet, showInternal);
      byThread.set(t.id, one.get(t.id) ?? []);
      // a supplier's own words are never shown to people who may only read the published board
      if (t.lane === "board" && !(s.writer || s.auditor || assigneeOk(s, t))) byThread.set(t.id, []);
    }
    const team = (await c.query(`select distinct m.id as membership_id, u.email from event_member em join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id join app_user u on u.id = m.user_id where em.event_id = $1 order by u.email`, [eventId])).rows.map((r) => ({ membershipId: r.membership_id as string, email: r.email as string }));
    const teamMap = new Map(team.map((x) => [x.membershipId, x.email]));
    const now = Date.now();
    const unreadOf = (id: string) => (byThread.get(id) ?? []).filter((m) => m.unread && !m.mine && m.by !== "system").length;
    const board: BoardItem[] = visible.filter((t) => t.lane === "board").map((t) => {
      const ms = byThread.get(t.id) ?? [];
      const first = ms.find((m) => m.by === "supplier");
      const full = s.writer || s.auditor || assigneeOk(s, t);
      return { id: t.id, anchorLabel: t.anchor_label, question: full ? (first?.body ?? t.public_question ?? "") : (t.public_question ?? ""), asker: full ? t.supplier_name : null, mine: false, status: t.status, confidential: t.confidential, confidentialReason: full ? t.confidential_reason : null,
        assignee: t.assignee_membership_id ? { membershipId: t.assignee_membership_id, email: teamMap.get(t.assignee_membership_id) ?? "" } : null, dueAt: iso(t.due_at), overdue: !!t.due_at && t.status === "open" && new Date(t.due_at).getTime() < now,
        published: !!t.published_at, publicQuestion: t.public_question, publicAnswer: t.public_answer, scopeChange: t.scope_change, mergedInto: t.merged_into, createdAt: iso(t.created_at)!, messages: ms, unread: unreadOf(t.id) };
    });
    const priv: PrivateThread[] = visible.filter((t) => t.lane === "private").map((t) => ({ id: t.id, supplierId: t.supplier_id, supplierName: t.supplier_name, messages: byThread.get(t.id) ?? [], unread: unreadOf(t.id), requestDueAt: iso(t.request_due_at), lastAt: iso(t.last_message_at) }));
    if (readPrivate && s.phase !== "none") {
      const have = new Set(priv.map((p) => p.supplierId));
      for (const r of (await c.query(`select so.id, so.name from invitation i join supplier_org so on so.tenant_id = i.tenant_id and so.id = i.supplier_id where i.event_id = $1 order by so.name`, [eventId])).rows)
        if (!have.has(r.id)) priv.push({ id: null, supplierId: r.id, supplierName: r.name, messages: [], unread: 0, requestDueAt: null, lastAt: null });
    }
    const invited = (await c.query(`select so.id, so.name from invitation i join supplier_org so on so.tenant_id = i.tenant_id and so.id = i.supplier_id where i.event_id = $1`, [eventId])).rows;
    const notices: Notice[] = [];
    for (const t of visible.filter((x) => x.lane === "notice")) {
      const m = (byThread.get(t.id) ?? [])[0]; if (!m) continue;
      const ackd = new Set((await c.query(`select distinct su.supplier_id from message_receipt r join supplier_user su on su.user_id = r.user_id where r.message_id = $1 and r.ack_at is not null`, [m.id])).rows.map((r) => r.supplier_id as string));
      notices.push({ id: m.id, body: m.body, at: m.at, files: m.files, acknowledged: false, ackCount: invited.filter((i) => ackd.has(i.id)).length, total: invited.length, pending: s.writer ? invited.filter((i) => !ackd.has(i.id)).map((i) => i.name as string) : [], unread: false });
    }
    if (s.auditor && !s.writer && priv.some((p) => p.messages.length)) await audit(c, internal(who), eventId, "messages.read_private", {});
    const items = (await c.query(`select id, line_no, description from event_item where event_id = $1 order by line_no`, [eventId])).rows.map((r) => ({ id: r.id as string, lineNo: r.line_no as number, description: r.description as string }));
    return { phase: s.phase, rules: s.rules, deadlines: deadlinesOf(s.ev), board, threads: priv, notices: notices.reverse(), canWrite: s.writer, canReadPrivate: readPrivate, team, items,
      unread: { board: board.reduce((n, b) => n + b.unread, 0), private: priv.reduce((n, p) => n + p.unread, 0), notice: 0 }, me: { membershipId: s.memberships[0] ?? null } };
  });
}

export async function supplierOverview(pool: Pool, who: SupplierWho, eventId: string): Promise<Overview | null> {
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await supCtx(c, who, eventId); if (!s) return null;
    const threads = (await c.query(`select * from message_thread where event_id = $1 and (
        (lane = 'board' and (supplier_id = $2 or published_at is not null)) or (lane = 'private' and supplier_id = $2) or lane = 'notice') order by created_at`, [eventId, who.supplierId])).rows;
    const mineIds = threads.filter((t) => t.supplier_id === who.supplierId || t.lane === "notice").map((t) => t.id);
    const msgs = mineIds.length ? (await c.query(`select * from message where thread_id = any($1::uuid[]) and not internal order by seq`, [mineIds])).rows : [];
    const files = await loadFiles(c, msgs.map((m) => m.id));
    const readSet = new Set((await c.query(`select message_id from message_receipt where user_id = $1`, [s.userId])).rows.map((r) => r.message_id as string));
    const ackSet = new Set((await c.query(`select message_id from message_receipt where user_id = $1 and ack_at is not null`, [s.userId])).rows.map((r) => r.message_id as string));
    const byThread = mapMsgs(msgs, files, s.userId, new Map(), readSet, false);
    const published = new Map(threads.filter((t) => t.published_at).map((t) => [t.id as string, t]));
    const board: BoardItem[] = threads.filter((t) => t.lane === "board").map((t) => {
      const mine = t.supplier_id === who.supplierId;
      const target = t.status === "merged" && t.merged_into ? published.get(t.merged_into) : null;
      const ms = mine ? (byThread.get(t.id) ?? []) : [];
      const first = ms.find((m) => m.by === "supplier");
      return { id: t.id, anchorLabel: t.anchor_label, question: mine ? (first?.body ?? t.public_question ?? "") : (t.public_question ?? ""), asker: null, mine, status: t.status, confidential: t.confidential, confidentialReason: mine ? t.confidential_reason : null, assignee: null, dueAt: null, overdue: false,
        published: !!t.published_at, publicQuestion: target ? target.public_question : t.public_question, publicAnswer: target ? target.public_answer : t.public_answer, scopeChange: target ? target.scope_change : t.scope_change, mergedInto: t.merged_into, createdAt: iso(t.created_at)!,
        messages: mine ? ms.filter((m) => m.by !== "system") : [], unread: ms.filter((m) => m.unread && !m.mine).length };
    });
    const pt = threads.find((t) => t.lane === "private");
    const priv: PrivateThread = { id: pt?.id ?? null, supplierId: who.supplierId, supplierName: null, messages: pt ? (byThread.get(pt.id) ?? []) : [], unread: pt ? (byThread.get(pt.id) ?? []).filter((m) => m.unread && !m.mine).length : 0, requestDueAt: iso(pt?.request_due_at), lastAt: iso(pt?.last_message_at) };
    const notices: Notice[] = [];
    for (const t of threads.filter((x) => x.lane === "notice")) {
      const m = (byThread.get(t.id) ?? [])[0]; if (!m) continue;
      notices.push({ id: m.id, body: m.body, at: m.at, files: m.files, acknowledged: ackSet.has(m.id), ackCount: 0, total: 0, pending: [], unread: !readSet.has(m.id) });
    }
    const items = (await c.query(`select id, line_no, description from event_item where event_id = $1 order by line_no`, [eventId])).rows.map((r) => ({ id: r.id as string, lineNo: r.line_no as number, description: r.description as string }));
    const canReply = supplierMayReply(s.phase, pt?.request_due_at ?? null);
    return { phase: s.phase, rules: { ...s.rules, supplierReplies: s.rules.supplierReplies && canReply }, deadlines: deadlinesOf(s.ev), board: board.reverse(), threads: [priv], notices: notices.reverse(),
      unread: { board: board.reduce((n, b) => n + b.unread, 0), private: priv.unread, notice: notices.filter((n) => n.unread).length }, canWrite: false, canReadPrivate: true, team: [], items, me: { membershipId: null } };
  });
}

/** Records that the reader has seen what is currently visible to them in a lane. */
export async function markSeen(pool: Pool, who: Who | SupplierWho, eventId: string, lane: "board" | "private" | "notice"): Promise<MOut> {
  return withTenant(pool, who.tenantId, async (c) => {
    const isSup = "supplierUserId" in who;
    if (isSup) {
      const s = await supCtx(c, who as SupplierWho, eventId); if (!s) return bad("This event is not available to you.");
      await c.query(`insert into message_receipt (tenant_id, message_id, user_id) select m.tenant_id, m.id, $1 from message m join message_thread t on t.tenant_id = m.tenant_id and t.id = m.thread_id
                      where t.event_id = $2 and t.lane = $3 and not m.internal and m.author_kind <> 'supplier' and (t.lane = 'notice' or t.supplier_id = $4) on conflict do nothing`, [s.userId, eventId, lane, (who as SupplierWho).supplierId]);
    } else {
      const s = await staffCtx(c, who as Who, eventId); if (!s) return bad("This event is not available to you.");
      if (lane === "private" && !(s.writer || s.auditor)) return { ok: true as const };
      await c.query(`insert into message_receipt (tenant_id, message_id, user_id) select m.tenant_id, m.id, $1 from message m join message_thread t on t.tenant_id = m.tenant_id and t.id = m.thread_id
                      where t.event_id = $2 and t.lane = $3 and not m.internal and m.author_kind = 'supplier' on conflict do nothing`, [(who as Who).userId, eventId, lane]);
    }
    return { ok: true as const };
  });
}

// ---------- supplier actions ----------
export async function askBoard(pool: Pool, who: SupplierWho, eventId: string, input: { text: string; anchorItemId?: string | null; confidential?: boolean; reason?: string }, files?: FileIn[]): Promise<MOut<{ id: string }>> {
  const body = (input.text ?? "").trim();
  if (body.length < 5) return bad("Write your question (at least 5 characters).");
  if (body.length > 2000) return bad("The question is too long (2,000 characters at most).");
  if (input.confidential && (input.reason ?? "").trim().length < 5) return bad("Say why the question is confidential (at least 5 characters).");
  const sc = await screen(files); if (!sc.ok) return sc;
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await supCtx(c, who, eventId); if (!s) return bad("This event is not available to you.");
    if (!s.rules.askBoard) return bad(s.phase === "open" ? "The deadline for questions has passed." : "Questions can only be asked while the event is open.");
    let label: string | null = null;
    if (input.anchorItemId) {
      if (!UUID.test(input.anchorItemId)) return bad("That line was not found.");
      const it = (await c.query(`select line_no, description from event_item where id = $1 and event_id = $2`, [input.anchorItemId, eventId])).rows[0];
      if (!it) return bad("That line was not found.");
      label = `#${it.line_no} ${String(it.description).slice(0, 80)}`;
    }
    const t = (await c.query(`insert into message_thread (tenant_id, event_id, lane, supplier_id, anchor_item_id, anchor_label, confidential, confidential_reason) values ($1,$2,'board',$3,$4,$5,$6,$7) returning id`,
      [who.tenantId, eventId, who.supplierId, input.anchorItemId || null, label, !!input.confidential, input.confidential ? input.reason!.trim().slice(0, 500) : null])).rows[0].id as string;
    await addMessage(c, { tenantId: who.tenantId, threadId: t, eventId, kind: "supplier", userId: s.userId, body, files: sc.ok_files });
    await audit(c, supplierActor(who), eventId, "message.question_asked", { confidential: !!input.confidential });
    await notify(c, who.tenantId, await staffUsers(c, eventId, buyerRoles), eventId, "question", `A supplier asked a question on ${s.ev.ref}.`);
    return { ok: true as const, id: t };
  });
}

export async function withdrawQuestion(pool: Pool, who: SupplierWho, eventId: string, threadId: string): Promise<MOut> {
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await supCtx(c, who, eventId); if (!s) return bad("This event is not available to you.");
    const t = await threadOf(c, eventId, threadId, "board");
    if (!t || t.supplier_id !== who.supplierId) return bad("Question not found.");
    if (t.published_at) return bad("A published question cannot be withdrawn.");
    if (t.status === "closed") return { ok: true as const };
    await c.query(`update message_thread set status = 'closed' where id = $1`, [threadId]);
    await audit(c, supplierActor(who), eventId, "message.question_withdrawn", {});
    return { ok: true as const };
  });
}

export async function supplierSend(pool: Pool, who: SupplierWho, eventId: string, text: string, files?: FileIn[]): Promise<MOut<{ id: string }>> {
  const body = (text ?? "").trim();
  if (body.length < 1) return bad("Write a message.");
  if (body.length > 4000) return bad("The message is too long (4,000 characters at most).");
  const sc = await screen(files); if (!sc.ok) return sc;
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await supCtx(c, who, eventId); if (!s) return bad("This event is not available to you.");
    let t = (await c.query(`select * from message_thread where event_id = $1 and lane = 'private' and supplier_id = $2`, [eventId, who.supplierId])).rows[0];
    if (!t) {
      if (!s.rules.supplierStartsPrivate) return bad("Messages to the buyer are closed for this event.");
      t = (await c.query(`insert into message_thread (tenant_id, event_id, lane, supplier_id) values ($1,$2,'private',$3) on conflict do nothing returning *`, [who.tenantId, eventId, who.supplierId])).rows[0]
        ?? (await c.query(`select * from message_thread where event_id = $1 and lane = 'private' and supplier_id = $2`, [eventId, who.supplierId])).rows[0];
    } else if (!s.rules.supplierReplies || !supplierMayReply(s.phase, t.request_due_at)) {
      return bad(s.phase === "closed" ? "You can reply only to a clarification request from the buyer, before its deadline." : "Messages to the buyer are closed for this event.");
    }
    const id = await addMessage(c, { tenantId: who.tenantId, threadId: t.id, eventId, kind: "supplier", userId: s.userId, body, files: sc.ok_files });
    await audit(c, supplierActor(who), eventId, "message.sent", { lane: "private" });
    await notify(c, who.tenantId, await staffUsers(c, eventId, buyerRoles), eventId, "message", `A supplier sent a message on ${s.ev.ref}.`);
    return { ok: true as const, id };
  });
}

export async function acknowledgeNotice(pool: Pool, who: SupplierWho, eventId: string, messageId: string): Promise<MOut> {
  if (!UUID.test(messageId)) return bad("Notice not found.");
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await supCtx(c, who, eventId); if (!s) return bad("This event is not available to you.");
    const m = (await c.query(`select m.id from message m join message_thread t on t.tenant_id = m.tenant_id and t.id = m.thread_id where m.id = $1 and t.event_id = $2 and t.lane = 'notice'`, [messageId, eventId])).rows[0];
    if (!m) return bad("Notice not found.");
    await c.query(`insert into message_receipt (tenant_id, message_id, user_id, ack_at) values ($1,$2,$3,now()) on conflict (tenant_id, message_id, user_id) do update set ack_at = coalesce(message_receipt.ack_at, now())`, [who.tenantId, messageId, s.userId]);
    await audit(c, supplierActor(who), eventId, "message.notice_acknowledged", {});
    return { ok: true as const };
  });
}

// ---------- staff actions ----------
export async function setDeadlines(pool: Pool, who: Who, eventId: string, input: { questionDeadline: string | null; lastAnswerDate: string | null }): Promise<MOut> {
  const parse = (v: string | null) => (v ? new Date(v) : null);
  const qd = parse(input.questionDeadline), lad = parse(input.lastAnswerDate);
  if ((qd && isNaN(qd.getTime())) || (lad && isNaN(lad.getTime()))) return bad("Enter valid dates.");
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await staffCtx(c, who, eventId); if (!s) return bad("This event is not available to you.");
    if (!s.writer) return bad("Only the buyer can set these deadlines.");
    if (!["none", "open"].includes(s.phase)) return bad("The deadlines can no longer change.");
    const closes = s.ev.closesAt;
    if (qd && closes && qd > closes) return bad("The question deadline must be before the closing time.");
    if (lad && closes && lad > closes) return bad("The last answer date must be before the closing time.");
    if (qd && lad && lad < qd) return bad("The last answer date must be after the question deadline.");
    await c.query(`update sourcing_event set question_deadline = $2, last_answer_date = $3 where id = $1`, [eventId, qd, lad]);
    await audit(c, internal(who), eventId, "message.deadlines_set", { questionDeadline: qd?.toISOString() ?? null, lastAnswerDate: lad?.toISOString() ?? null });
    return { ok: true as const };
  });
}

async function boardForStaff(c: PoolClient, s: Staff, eventId: string, threadId: string, needWriter: boolean) {
  const t = await threadOf(c, eventId, threadId, "board");
  if (!t) return { err: bad("Question not found.") };
  if (needWriter ? !s.writer : !(s.writer || assigneeOk(s, t))) return { err: bad(needWriter ? "Only the buyer can do that." : "Only the buyer or the person assigned can answer.") };
  return { t };
}

export async function assignQuestion(pool: Pool, who: Who, eventId: string, threadId: string, membershipId: string | null, dueAt: string | null): Promise<MOut> {
  const due = dueAt ? new Date(dueAt) : null;
  if (due && isNaN(due.getTime())) return bad("Enter a valid due time.");
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await staffCtx(c, who, eventId); if (!s) return bad("This event is not available to you.");
    const r = await boardForStaff(c, s, eventId, threadId, true); if (r.err) return r.err;
    let userId: string | null = null;
    if (membershipId) {
      const m = (await c.query(`select m.user_id from event_member em join membership m on m.tenant_id = em.tenant_id and m.id = em.membership_id where em.event_id = $1 and m.id = $2 limit 1`, [eventId, membershipId])).rows[0];
      if (!m) return bad("Choose a member of this event's team.");
      userId = m.user_id;
    }
    await c.query(`update message_thread set assignee_membership_id = $2, due_at = $3 where id = $1`, [threadId, membershipId, due]);
    await audit(c, internal(who), eventId, "message.assigned", { threadId });
    if (userId) await notify(c, who.tenantId, [userId], eventId, "question", `A supplier question on ${s.ev.ref} was assigned to you.`);
    return { ok: true as const };
  });
}

export async function addNote(pool: Pool, who: Who, eventId: string, threadId: string, text: string): Promise<MOut> {
  const body = (text ?? "").trim();
  if (body.length < 2) return bad("Write the note.");
  if (body.length > 4000) return bad("The note is too long (4,000 characters at most).");
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await staffCtx(c, who, eventId); if (!s) return bad("This event is not available to you.");
    const r = await boardForStaff(c, s, eventId, threadId, false); if (r.err) return r.err;
    await addMessage(c, { tenantId: who.tenantId, threadId, eventId, kind: "staff", userId: who.userId, body, internal: true });
    return { ok: true as const };
  });
}

export async function answerBoard(pool: Pool, who: Who, eventId: string, threadId: string, text: string, files?: FileIn[]): Promise<MOut> {
  const body = (text ?? "").trim();
  if (body.length < 2) return bad("Write the answer.");
  if (body.length > 4000) return bad("The answer is too long (4,000 characters at most).");
  const sc = await screen(files); if (!sc.ok) return sc;
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await staffCtx(c, who, eventId); if (!s) return bad("This event is not available to you.");
    const r = await boardForStaff(c, s, eventId, threadId, false); if (r.err) return r.err;
    if (!s.rules.answerBoard) return bad("Questions can only be answered while the event is open.");
    if (["closed", "merged"].includes(r.t.status)) return bad("That question is closed.");
    await addMessage(c, { tenantId: who.tenantId, threadId, eventId, kind: "staff", userId: who.userId, body, files: sc.ok_files });
    await c.query(`update message_thread set status = 'answered' where id = $1`, [threadId]);
    await audit(c, internal(who), eventId, "message.answered", { late: s.rules.late });
    await notify(c, who.tenantId, await supplierUsers(c, r.t.supplier_id), eventId, "answer", `The buyer answered your question on ${s.ev.ref}.`);
    return { ok: true as const };
  });
}

/** What the answer would look like without the asker's identity, for the buyer to review and edit before publishing. */
export async function suggestPublic(pool: Pool, who: Who, eventId: string, threadId: string): Promise<MOut<{ publicQuestion: string; publicAnswer: string; changed: boolean }>> {
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await staffCtx(c, who, eventId); if (!s) return bad("This event is not available to you.");
    const r = await boardForStaff(c, s, eventId, threadId, true); if (r.err) return r.err;
    const q = (await c.query(`select body from message where thread_id = $1 and author_kind = 'supplier' order by seq limit 1`, [threadId])).rows[0]?.body ?? "";
    const a = (await c.query(`select body from message where thread_id = $1 and author_kind = 'staff' and not internal order by seq desc limit 1`, [threadId])).rows[0]?.body ?? "";
    const names = await allSupplierNames(c);
    const rq = redact(q, names), ra = redact(a, names);
    return { ok: true as const, publicQuestion: rq.text, publicAnswer: ra.text, changed: rq.changed || ra.changed };
  });
}

async function publishCore(c: PoolClient, who: Who, s: Staff, eventId: string, threadId: string, pub: { publicQuestion: string; publicAnswer: string; scopeChange: boolean }) {
  await c.query(`update message_thread set public_question = $2, public_answer = $3, scope_change = $4, published_at = now(), published_by = $5, status = 'answered' where id = $1`, [threadId, pub.publicQuestion.trim(), pub.publicAnswer.trim(), pub.scopeChange, who.userId]);
  await audit(c, internal(who), eventId, "message.published", { scopeChange: pub.scopeChange, late: s.rules.late });
  await notify(c, who.tenantId, await invitedUsers(c, eventId), eventId, "answer",
    pub.scopeChange ? `A clarification on ${s.ev.ref} changes the requirement. Review it before you submit.` : `A clarification was published on ${s.ev.ref}.`);
}

export async function publishBoard(pool: Pool, who: Who, eventId: string, threadId: string, input: { publicQuestion: string; publicAnswer: string; scopeChange?: boolean }): Promise<MOut> {
  const q = (input.publicQuestion ?? "").trim(), a = (input.publicAnswer ?? "").trim();
  if (q.length < 5 || a.length < 2) return bad("Write the question and the answer to publish.");
  if (q.length > 4000 || a.length > 4000) return bad("The text is too long (4,000 characters at most).");
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await staffCtx(c, who, eventId); if (!s) return bad("This event is not available to you.");
    const r = await boardForStaff(c, s, eventId, threadId, true); if (r.err) return r.err;
    if (!s.rules.answerBoard) return bad("Questions can only be answered while the event is open.");
    if (r.t.confidential) return bad("A confidential question cannot be published. Move it to the shared board first.");
    if (r.t.status === "merged" || r.t.status === "closed") return bad("That question is closed.");
    const names = await allSupplierNames(c);
    const leak = names.find((n) => n.trim().length >= 3 && (`${q} ${a}`).toLowerCase().includes(n.trim().toLowerCase()));
    if (leak) return bad("The text still names a bidder. Remove the name before publishing.");
    await publishCore(c, who, s, eventId, threadId, { publicQuestion: q, publicAnswer: a, scopeChange: !!input.scopeChange });
    return { ok: true as const };
  });
}

export async function reclassify(pool: Pool, who: Who, eventId: string, threadId: string): Promise<MOut> {
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await staffCtx(c, who, eventId); if (!s) return bad("This event is not available to you.");
    const r = await boardForStaff(c, s, eventId, threadId, true); if (r.err) return r.err;
    if (!r.t.confidential) return { ok: true as const };
    await c.query(`update message_thread set confidential = false where id = $1`, [threadId]);
    await audit(c, internal(who), eventId, "message.reclassified", { threadId });
    await notify(c, who.tenantId, await supplierUsers(c, r.t.supplier_id), eventId, "question", `The buyer will treat your question on ${s.ev.ref} as a general one. You can withdraw it if you disagree.`);
    return { ok: true as const };
  });
}

export async function mergeThreads(pool: Pool, who: Who, eventId: string, threadId: string, intoId: string): Promise<MOut> {
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await staffCtx(c, who, eventId); if (!s) return bad("This event is not available to you.");
    const r = await boardForStaff(c, s, eventId, threadId, true); if (r.err) return r.err;
    const into = await threadOf(c, eventId, intoId, "board");
    if (!into || into.id === threadId || into.status === "merged" || into.status === "closed") return bad("Choose another open question to combine with.");
    if (r.t.published_at) return bad("A published question cannot be combined.");
    await c.query(`update message_thread set status = 'merged', merged_into = $2 where id = $1`, [threadId, intoId]);
    await audit(c, internal(who), eventId, "message.merged", { threadId, intoId });
    return { ok: true as const };
  });
}

export async function staffReply(pool: Pool, who: Who, eventId: string, supplierId: string, text: string, opts: { files?: FileIn[]; decision?: Decision; requestDueAt?: string | null } = {}): Promise<MOut<{ id: string }>> {
  const body = (text ?? "").trim();
  if (body.length < 1) return bad("Write a message.");
  if (body.length > 4000) return bad("The message is too long (4,000 characters at most).");
  if (!UUID.test(supplierId)) return bad("Supplier not found.");
  const sc = await screen(opts.files); if (!sc.ok) return sc;
  const due = opts.requestDueAt ? new Date(opts.requestDueAt) : null;
  if (due && isNaN(due.getTime())) return bad("Enter a valid deadline for the reply.");
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await staffCtx(c, who, eventId); if (!s) return bad("This event is not available to you.");
    if (!s.writer) return bad("Only the buyer can write to a supplier.");
    if (!s.rules.staffStartsPrivate) return bad("Messages to suppliers are closed for this event.");
    if (!(await c.query(`select 1 from invitation where event_id = $1 and supplier_id = $2`, [eventId, supplierId])).rowCount) return bad("That supplier is not invited to this event.");
    if (s.phase === "closed" && (!due || due.getTime() <= Date.now())) return bad("After closing, set a future deadline for the supplier's reply.");
    if (due && due.getTime() > Date.now() + 60 * 86400000) return bad("The reply deadline can be at most 60 days away.");
    const d = opts.decision;
    if (s.phase === "open" && !d && looksLikeClarification(body)) {
      const names = await allSupplierNames(c);
      const last = (await c.query(`select m.body from message m join message_thread t on t.tenant_id = m.tenant_id and t.id = m.thread_id where t.event_id = $1 and t.lane = 'private' and t.supplier_id = $2 and m.author_kind = 'supplier' order by m.seq desc limit 1`, [eventId, supplierId])).rows[0]?.body ?? "";
      return { ok: false as const, error: "This looks like it affects every bidder. Share it on the board, or say why it stays private.", needsDecision: { publicQuestion: redact(last, names).text, publicAnswer: redact(body, names).text } };
    }
    if (d?.keepPrivateReason !== undefined && d.keepPrivateReason.trim().length < 5) return bad("Say why this stays private (at least 5 characters).");
    let t = (await c.query(`select * from message_thread where event_id = $1 and lane = 'private' and supplier_id = $2`, [eventId, supplierId])).rows[0];
    if (!t) t = (await c.query(`insert into message_thread (tenant_id, event_id, lane, supplier_id) values ($1,$2,'private',$3) on conflict do nothing returning *`, [who.tenantId, eventId, supplierId])).rows[0]
      ?? (await c.query(`select * from message_thread where event_id = $1 and lane = 'private' and supplier_id = $2`, [eventId, supplierId])).rows[0];
    if (due) await c.query(`update message_thread set request_due_at = $2 where id = $1`, [t.id, due]);
    const id = await addMessage(c, { tenantId: who.tenantId, threadId: t.id, eventId, kind: "staff", userId: who.userId, body, guardReason: d?.keepPrivateReason?.trim().slice(0, 500) ?? null, files: sc.ok_files });
    await audit(c, internal(who), eventId, "message.sent", { lane: "private", request: !!due, keptPrivate: d?.keepPrivateReason ? d.keepPrivateReason.trim() : undefined });
    await notify(c, who.tenantId, await supplierUsers(c, supplierId), eventId, "message", due ? `The buyer asked for a reply on ${s.ev.ref} by ${due.toISOString().slice(0, 16).replace("T", " ")} UTC.` : `The buyer sent you a message on ${s.ev.ref}.`);
    if (d?.share) {
      const pq = d.share.publicQuestion.trim(), pa = d.share.publicAnswer.trim();
      if (pq.length < 5 || pa.length < 2) return bad("Write the question and the answer to publish.");
      const names = await allSupplierNames(c);
      if (names.some((n) => n.trim().length >= 3 && (`${pq} ${pa}`).toLowerCase().includes(n.trim().toLowerCase()))) return bad("The text still names a bidder. Remove the name before publishing.");
      const bt = (await c.query(`insert into message_thread (tenant_id, event_id, lane, supplier_id, status) values ($1,$2,'board',$3,'answered') returning id`, [who.tenantId, eventId, supplierId])).rows[0].id as string;
      await addMessage(c, { tenantId: who.tenantId, threadId: bt, eventId, kind: "system", userId: null, body: "Published from a private reply." });
      await publishCore(c, who, s, eventId, bt, { publicQuestion: pq, publicAnswer: pa, scopeChange: false });
    }
    return { ok: true as const, id };
  });
}

export async function sendNotice(pool: Pool, who: Who, eventId: string, text: string, files?: FileIn[]): Promise<MOut<{ id: string }>> {
  const body = (text ?? "").trim();
  if (body.length < 5) return bad("Write the notice (at least 5 characters).");
  if (body.length > 4000) return bad("The notice is too long (4,000 characters at most).");
  const sc = await screen(files); if (!sc.ok) return sc;
  return withTenant(pool, who.tenantId, async (c) => {
    const s = await staffCtx(c, who, eventId); if (!s) return bad("This event is not available to you.");
    if (!s.writer) return bad("Only the buyer can send notices.");
    if (!s.rules.notices) return bad("Notices can be sent once the event is published.");
    const t = (await c.query(`insert into message_thread (tenant_id, event_id, lane, subject) values ($1,$2,'notice',$3) returning id`, [who.tenantId, eventId, body.slice(0, 80)])).rows[0].id as string;
    const id = await addMessage(c, { tenantId: who.tenantId, threadId: t, eventId, kind: "staff", userId: who.userId, body, files: sc.ok_files });
    await audit(c, internal(who), eventId, "message.notice_sent", {});
    await notify(c, who.tenantId, await invitedUsers(c, eventId), eventId, "notice", `A notice was posted on ${s.ev.ref}. Please read and acknowledge it.`);
    return { ok: true as const, id };
  });
}

// ---------- files ----------
/** Returns a message attachment if the reader may see the message it belongs to. */
export async function readMessageFile(pool: Pool, viewer: { staff: Who } | { supplier: SupplierWho }, fileId: string): Promise<{ filename: string; mime: string; content: Buffer } | null> {
  if (!UUID.test(fileId)) return null;
  const tenantId = "staff" in viewer ? viewer.staff.tenantId : viewer.supplier.tenantId;
  return withTenant(pool, tenantId, async (c) => {
    const f = (await c.query(`select f.filename, f.mime, f.content, m.internal, m.event_id, m.author_kind, t.lane, t.supplier_id, t.published_at, t.assignee_membership_id
                                from message_file f join message m on m.tenant_id = f.tenant_id and m.id = f.message_id join message_thread t on t.tenant_id = m.tenant_id and t.id = m.thread_id where f.id = $1`, [fileId])).rows[0];
    if (!f) return null;
    if ("supplier" in viewer) {
      const s = await supCtx(c, viewer.supplier, f.event_id); if (!s || f.internal) return null;
      const ok = f.lane === "notice" || f.supplier_id === viewer.supplier.supplierId;
      if (!ok) return null;
    } else {
      const s = await staffCtx(c, viewer.staff, f.event_id); if (!s) return null;
      const full = s.writer || s.auditor || (f.assignee_membership_id && s.memberships.includes(f.assignee_membership_id));
      if (f.internal && !full) return null;
      if (f.lane === "private" && !(s.writer || s.auditor)) return null;
      if (f.lane === "board" && !full && !f.published_at) return null;
    }
    return { filename: f.filename, mime: f.mime, content: f.content as Buffer };
  });
}

export async function unansweredCount(c: PoolClient, eventId: string): Promise<number> {
  return (await c.query(`select count(*)::int n from message_thread where event_id = $1 and lane = 'board' and status = 'open'`, [eventId])).rows[0].n;
}
