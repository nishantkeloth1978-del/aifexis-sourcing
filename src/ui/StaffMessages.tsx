"use client";
import { useState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { BoardItem, Overview } from "@/messages/service";
import { answerMessageAction, assignAction, markSeenAction, mergeAction, noteAction, noticeAction, pollMessagesAction, publishAction, reclassifyAction, replyAction, setDeadlinesAction, suggestAction } from "../../app/events/[id]/messages-actions";
import { Bubbles, Composer, Deadlines, fmt, fromLocalInput, TabBar, toLocalInput, useLive } from "./messages/shared";

type Tab = "board" | "private" | "notice" | "settings";
const STATUS: Record<string, string> = { open: "Needs an answer", answered: "Answered", closed: "Closed", merged: "Combined" };

export default function StaffMessages({ locale, eventId, initial }: { locale: Locale; eventId: string; initial: Overview }) {
  const { ov, refresh } = useLive(initial, () => pollMessagesAction(eventId));
  const [tab, setTab] = useState<Tab>("board");
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "answered" | "published">("all");
  const [sel, setSel] = useState<string | null>(ov.threads[0]?.supplierId ?? null);
  const open = async (t: Tab) => { setTab(t); if (t !== "settings") { await markSeenAction(eventId, t); await refresh(); } };
  const fail = async (r: { ok: boolean; error?: string }) => { setMsg(r.ok ? null : (r.error ?? "That could not be saved. Try again.")); await refresh(); return r; };
  const tabs: { key: Tab; label: string; badge?: number }[] = [{ key: "board", label: tx(locale, "Questions and answers"), badge: ov.board.filter((b) => b.status === "open").length }];
  if (ov.canReadPrivate) tabs.push({ key: "private", label: tx(locale, "Supplier threads"), badge: ov.unread.private });
  tabs.push({ key: "notice", label: tx(locale, "Notices") });
  if (ov.canWrite) tabs.push({ key: "settings", label: tx(locale, "Deadlines") });
  const list = ov.board.filter((b) => filter === "all" || (filter === "open" ? b.status === "open" : filter === "answered" ? b.status === "answered" && !b.published : b.published));
  return (
    <div className="card detail" id="messages">
      <h3>{tx(locale, "Messages")}</h3>
      <Deadlines d={ov.deadlines} locale={locale} late={ov.rules.late} />
      <TabBar locale={locale} on={tab} set={open} tabs={tabs} />
      {msg && <div className="alert" role="alert">{tx(locale, msg)}</div>}

      {tab === "board" && <div>
        <label className="sub">{tx(locale, "Show")} <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">{tx(locale, "All")}</option><option value="open">{tx(locale, "Needs an answer")}</option><option value="answered">{tx(locale, "Answered, not published")}</option><option value="published">{tx(locale, "Published to all bidders")}</option></select></label>
        {list.length === 0 && <div className="sub">{tx(locale, "No questions yet.")}</div>}
        {list.map((b) => <BoardCard key={b.id} b={b} ov={ov} locale={locale} eventId={eventId} fail={fail} others={ov.board.filter((x) => x.id !== b.id && ["open", "answered"].includes(x.status) && !x.published)} />)}
      </div>}

      {tab === "private" && <div className="split">
        <ul className="team" aria-label={tx(locale, "Suppliers")}>
          {ov.threads.map((p) => <li key={p.supplierId}><button type="button" className={`linkbtn ${sel === p.supplierId ? "on" : ""}`} onClick={() => setSel(p.supplierId)}>{p.supplierName}{p.unread > 0 && <span className="badge"> {p.unread}</span>}</button>
            {p.lastAt && <span className="sub"> {fmt(p.lastAt, locale)}</span>}</li>)}
        </ul>
        <div>{ov.threads.filter((p) => p.supplierId === sel).map((p) => <PrivateView key={p.supplierId} p={p} ov={ov} locale={locale} eventId={eventId} fail={fail} />)}
          {!sel && <div className="sub">{tx(locale, "Choose a supplier.")}</div>}</div>
      </div>}

      {tab === "notice" && <div>
        {ov.canWrite && ov.rules.notices && <Composer locale={locale} label={tx(locale, "Notice to all bidders")} button={tx(locale, "Send notice")} onSend={async (fd) => fail(await noticeAction(eventId, fd))} />}
        {ov.notices.length === 0 && <div className="sub">{tx(locale, "No notices yet.")}</div>}
        {ov.notices.map((n) => (
          <div key={n.id} className="bidcard"><div className="sub">{fmt(n.at, locale)}</div><div className="body">{n.body}</div>
            {n.files.length > 0 && <ul className="files">{n.files.map((f) => <li key={f.id}><a href={`/api/messages/files/${f.id}`}>{f.filename}</a></li>)}</ul>}
            {n.total > 0 && <div className="sub">{tx(locale, "Acknowledged by {a} of {n} bidders", { a: n.ackCount, n: n.total })}{n.pending.length > 0 && <> · {tx(locale, "Waiting for")}: {n.pending.join(", ")}</>}</div>}</div>
        ))}
      </div>}

      {tab === "settings" && <Settings ov={ov} locale={locale} eventId={eventId} fail={fail} />}
    </div>
  );
}

function Settings({ ov, locale, eventId, fail }: { ov: Overview; locale: Locale; eventId: string; fail: (r: { ok: boolean; error?: string }) => Promise<unknown> }) {
  const [qd, setQd] = useState(toLocalInput(ov.deadlines.questionDeadline));
  const [lad, setLad] = useState(toLocalInput(ov.deadlines.lastAnswerDate));
  return (
    <div>
      <p className="sub">{tx(locale, "Suppliers can ask until the question deadline. Publish your answers by the last answer date so bidders have time to use them. Both must be before the closing time.")}</p>
      <label>{tx(locale, "Question deadline")} <input type="datetime-local" value={qd} onChange={(e) => setQd(e.target.value)} /></label>
      <label>{tx(locale, "Last answer date")} <input type="datetime-local" value={lad} onChange={(e) => setLad(e.target.value)} /></label>
      <div className="actions"><button className="btn" type="button" onClick={async () => { await fail(await setDeadlinesAction(eventId, fromLocalInput(qd), fromLocalInput(lad))); }}>{tx(locale, "Save deadlines")}</button></div>
    </div>
  );
}

function BoardCard({ b, ov, locale, eventId, fail, others }: { b: BoardItem; ov: Overview; locale: Locale; eventId: string; fail: (r: { ok: boolean; error?: string }) => Promise<unknown>; others: BoardItem[] }) {
  const [pub, setPub] = useState<{ q: string; a: string; scope: boolean; changed: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState(b.assignee?.membershipId ?? "");
  const [due, setDue] = useState(toLocalInput(b.dueAt));
  const [mergeTo, setMergeTo] = useState("");
  const isMine = !!ov.me.membershipId && b.assignee?.membershipId === ov.me.membershipId;
  const canAct = (ov.canWrite || isMine) && !["closed", "merged"].includes(b.status);
  async function startPublish() {
    const r = await suggestAction(eventId, b.id);
    if (!r.ok) { await fail(r); return; }
    setPub({ q: r.publicQuestion, a: r.publicAnswer, scope: false, changed: r.changed });
  }
  return (
    <div className={`bidcard ${b.overdue ? "overdue" : ""}`}>
      <div className="row">
        <div>{b.anchorLabel && <span className="sub">{tx(locale, "About line")} {b.anchorLabel} · </span>}<b>{b.asker ?? tx(locale, "A bidder")}</b> <span className="chip">{tx(locale, STATUS[b.status] ?? "Open")}</span>
          {b.published && <span className="chip">{tx(locale, "Published")}</span>}{b.confidential && <span className="chip">{tx(locale, "Confidential")}</span>}{b.overdue && <span className="chip warn">{tx(locale, "Overdue")}</span>}</div>
        <span className="sub">{fmt(b.createdAt, locale)}</span>
      </div>
      {b.confidential && b.confidentialReason && <div className="sub">{tx(locale, "Reason given")}: {b.confidentialReason}</div>}
      {b.messages.length > 0 ? <Bubbles msgs={b.messages} locale={locale} staffView /> : <div><b>{tx(locale, "Q:")}</b> {b.question}</div>}
      {b.published && <div className="okbox"><b>{tx(locale, "Published")}:</b> {b.publicQuestion} → {b.publicAnswer}</div>}
      {b.assignee && <div className="sub">{tx(locale, "Assigned to {e}", { e: b.assignee.email })}{b.dueAt && ` · ${tx(locale, "due {d}", { d: fmt(b.dueAt, locale) })}`}</div>}
      {canAct && !pub && <>
        {ov.rules.answerBoard && <Composer locale={locale} label={tx(locale, "Answer")} button={tx(locale, "Send answer")} onSend={async (fd) => (await fail(await answerMessageAction(eventId, b.id, fd))) as { ok: boolean }} />}
        <div className="actions">
          {ov.canWrite && ov.rules.answerBoard && !b.published && !b.confidential && <button className="btn" type="button" onClick={startPublish}>{tx(locale, "Publish to all bidders")}</button>}
          {ov.canWrite && b.confidential && <button className="btn ghost" type="button" onClick={async () => { await fail(await reclassifyAction(eventId, b.id)); }}>{tx(locale, "Treat as a general question")}</button>}
        </div>
        <div className="additem">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx(locale, "Internal note (suppliers never see it)")} aria-label={tx(locale, "Internal note (suppliers never see it)")} maxLength={4000} />
          <button className="btn ghost" type="button" disabled={note.trim().length < 2} onClick={async () => { await fail(await noteAction(eventId, b.id, note)); setNote(""); }}>{tx(locale, "Add note")}</button>
        </div>
        {ov.canWrite && <>
          <div className="additem">
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label={tx(locale, "Assign to")}><option value="">{tx(locale, "Not assigned")}</option>{ov.team.map((t) => <option key={t.membershipId} value={t.membershipId}>{t.email}</option>)}</select>
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label={tx(locale, "Due")} />
            <button className="btn ghost" type="button" onClick={async () => { await fail(await assignAction(eventId, b.id, assignee || null, fromLocalInput(due))); }}>{tx(locale, "Save assignment")}</button>
          </div>
          {others.length > 0 && !b.published && <div className="additem">
            <select value={mergeTo} onChange={(e) => setMergeTo(e.target.value)} aria-label={tx(locale, "Combine with")}><option value="">{tx(locale, "Combine with a similar question")}</option>{others.map((o) => <option key={o.id} value={o.id}>{(o.question || "").slice(0, 70)}</option>)}</select>
            <button className="btn ghost" type="button" disabled={!mergeTo} onClick={async () => { await fail(await mergeAction(eventId, b.id, mergeTo)); }}>{tx(locale, "Combine")}</button>
          </div>}
        </>}
      </>}
      {pub && <div className="card">
        <h4>{tx(locale, "Publish to all bidders")}</h4>
        <p className="sub">{pub.changed ? tx(locale, "Names, e-mail addresses and phone numbers were removed. Check the text before publishing.") : tx(locale, "Check the text before publishing. It goes to every invited bidder.")}</p>
        <label>{tx(locale, "Question as bidders will see it")}<textarea rows={3} value={pub.q} onChange={(e) => setPub({ ...pub, q: e.target.value })} /></label>
        <label>{tx(locale, "Answer")}<textarea rows={3} value={pub.a} onChange={(e) => setPub({ ...pub, a: e.target.value })} /></label>
        <label className="sub"><input type="checkbox" checked={pub.scope} onChange={(e) => setPub({ ...pub, scope: e.target.checked })} /> {tx(locale, "This answer changes the requirement")}</label>
        <div className="actions"><button className="btn" type="button" onClick={async () => { const r = await publishAction(eventId, b.id, { publicQuestion: pub.q, publicAnswer: pub.a, scopeChange: pub.scope }); await fail(r); if (r.ok) setPub(null); }}>{tx(locale, "Publish")}</button>
          <button className="btn ghost" type="button" onClick={() => setPub(null)}>{tx(locale, "Cancel")}</button></div>
      </div>}
    </div>
  );
}

function PrivateView({ p, ov, locale, eventId, fail }: { p: Overview["threads"][number]; ov: Overview; locale: Locale; eventId: string; fail: (r: { ok: boolean; error?: string }) => Promise<unknown> }) {
  const [due, setDue] = useState("");
  const [guard, setGuard] = useState<{ fd: FormData; q: string; a: string; reason: string } | null>(null);
  const afterClose = ov.phase !== "open";
  async function send(fd: FormData) {
    const r = await replyAction(eventId, p.supplierId, fd, undefined, afterClose ? fromLocalInput(due) : null);
    if (!r.ok && r.needsDecision) { setGuard({ fd, q: r.needsDecision.publicQuestion, a: r.needsDecision.publicAnswer, reason: "" }); return { ok: true }; }
    await fail(r); return r;
  }
  async function decide(share: boolean) {
    if (!guard) return;
    const r = await replyAction(eventId, p.supplierId, guard.fd, share ? { share: { publicQuestion: guard.q, publicAnswer: guard.a } } : { keepPrivateReason: guard.reason }, afterClose ? fromLocalInput(due) : null);
    await fail(r); if (r.ok) setGuard(null);
  }
  return (
    <div>
      <h4>{p.supplierName}</h4>
      {p.requestDueAt && <div className="okbox">{tx(locale, "Reply requested by {d}", { d: fmt(p.requestDueAt, locale) })}</div>}
      <Bubbles msgs={p.messages} locale={locale} staffView />
      {p.messages.length === 0 && <div className="sub">{tx(locale, "No messages yet.")}</div>}
      {ov.canWrite && ov.rules.staffStartsPrivate && !guard && (
        <Composer locale={locale} label={afterClose ? tx(locale, "Clarification request") : tx(locale, "Message to this supplier")} button={tx(locale, "Send message")} onSend={send}>
          {afterClose && <label className="sub">{tx(locale, "Reply needed by")} <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} required /></label>}
        </Composer>
      )}
      {guard && <div className="card" role="alertdialog" aria-label={tx(locale, "Share with all bidders?")}>
        <h4>{tx(locale, "This looks like it affects every bidder")}</h4>
        <p className="sub">{tx(locale, "Bidders must receive the same information. Share it on the board without naming the supplier, or say why it stays private.")}</p>
        <label>{tx(locale, "Question as bidders will see it")}<textarea rows={3} value={guard.q} onChange={(e) => setGuard({ ...guard, q: e.target.value })} /></label>
        <label>{tx(locale, "Answer")}<textarea rows={3} value={guard.a} onChange={(e) => setGuard({ ...guard, a: e.target.value })} /></label>
        <div className="actions"><button className="btn" type="button" onClick={() => decide(true)}>{tx(locale, "Share on the board")}</button></div>
        <label>{tx(locale, "Or keep it private. Reason")} <input value={guard.reason} onChange={(e) => setGuard({ ...guard, reason: e.target.value })} maxLength={500} /></label>
        <div className="actions"><button className="btn ghost" type="button" disabled={guard.reason.trim().length < 5} onClick={() => decide(false)}>{tx(locale, "Keep private")}</button> <button className="btn ghost" type="button" onClick={() => setGuard(null)}>{tx(locale, "Cancel")}</button></div>
      </div>}
    </div>
  );
}
