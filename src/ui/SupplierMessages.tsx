"use client";
import { useState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { Overview } from "@/messages/service";
import { ackAction, askBoardAction, pollSupplierMessagesAction, supplierSeenAction, supplierSendAction, translateSupplierAction, withdrawAction } from "../../app/supplier/events/[id]/messages-actions";
import { Bubbles, Composer, Deadlines, fmt, TabBar, Translatable, useLive } from "./messages/shared";

type Tab = "board" | "private" | "notice";

export default function SupplierMessages({ locale, eventId, initial }: { locale: Locale; eventId: string; initial: Overview }) {
  const poll = () => pollSupplierMessagesAction(eventId);
  const { ov, refresh } = useLive(initial, poll);
  const [tab, setTab] = useState<Tab>("board");
  const [msg, setMsg] = useState<string | null>(null);
  const thread = ov.threads[0]!;
  const tr = (source: Parameters<typeof translateSupplierAction>[1]) => (ov.ai ? () => translateSupplierAction(eventId, source, locale) : undefined);
  const trMsg = ov.ai ? (id: string) => translateSupplierAction(eventId, { message: id }, locale) : undefined;
  async function open(t: Tab) { setTab(t); await supplierSeenAction(eventId, t); await refresh(); }
  const canWrite = thread.id ? ov.rules.supplierReplies : ov.rules.supplierStartsPrivate;
  return (
    <div className="card detail" id="messages">
      <h3>{tx(locale, "Messages")}</h3>
      <Deadlines d={ov.deadlines} locale={locale} />
      <TabBar locale={locale} on={tab} set={open} tabs={[
        { key: "board", label: tx(locale, "Questions and answers"), badge: ov.unread.board }, { key: "private", label: tx(locale, "Messages with the buyer"), badge: ov.unread.private }, { key: "notice", label: tx(locale, "Notices"), badge: ov.unread.notice }]} />
      {msg && <div className="alert" role="alert">{tx(locale, msg)}</div>}

      {tab === "board" && <div>
        <p className="sub">{tx(locale, "Questions about the requirement are answered for every bidder, without naming who asked.")}</p>
        {ov.board.length === 0 && <div className="sub">{tx(locale, "No questions yet.")}</div>}
        {ov.board.map((b) => (
          <div key={b.id} className="bidcard">
            {b.anchorLabel && <div className="sub">{tx(locale, "About line")} {b.anchorLabel}</div>}
            {b.scopeChange && b.published && <div className="alert">{tx(locale, "This answer changes the requirement. Check your bid.")}</div>}
            <div><b>{tx(locale, "Q:")}</b> {b.published ? b.publicQuestion : b.question} {b.mine && !b.published && <span className="chip">{tx(locale, "Your question")}</span>} {b.confidential && <span className="chip">{tx(locale, "Confidential")}</span>}</div>
            {b.published && <Translatable text={b.publicQuestion ?? ""} locale={locale} run={tr({ thread: b.id, field: "q" })} />}
            {b.published ? <div className="bidtext"><b>{tx(locale, "A:")}</b> {b.publicAnswer}<Translatable text={b.publicAnswer ?? ""} locale={locale} run={tr({ thread: b.id, field: "a" })} /></div>
              : b.status === "merged" ? <div className="sub">{tx(locale, "Combined with a similar question. The answer will be published for everyone.")}</div>
              : b.status === "closed" ? <div className="sub">{tx(locale, "Withdrawn.")}</div>
              : <Bubbles msgs={b.messages.slice(1)} locale={locale} staffView={false} translate={trMsg} />}
            {!b.published && b.mine && b.messages.length <= 1 && b.status === "open" && <div className="sub">{tx(locale, "Waiting for the buyer's answer.")}</div>}
            {b.mine && !b.published && b.status !== "closed" && <div className="actions"><button className="btn ghost" type="button" onClick={async () => { const r = await withdrawAction(eventId, b.id); if (!r.ok) setMsg(r.error); await refresh(); }}>{tx(locale, "Withdraw")}</button></div>}
          </div>
        ))}
        {ov.rules.askBoard ? (
          <Composer locale={locale} label={tx(locale, "Ask a question")} button={tx(locale, "Send question")} onSend={async (fd) => { const r = await askBoardAction(eventId, fd); if (r.ok) await refresh(); return r; }}>
            <label className="sub">{tx(locale, "About line (optional)")} <select name="anchor" defaultValue=""><option value="">{tx(locale, "The whole event")}</option>{ov.items.map((i) => <option key={i.id} value={i.id}>#{i.lineNo} {i.description.slice(0, 60)}</option>)}</select></label>
            <label className="sub"><input type="checkbox" name="confidential" /> {tx(locale, "This question is confidential to my company")}</label>
            <label className="sub">{tx(locale, "Reason (required if confidential)")} <input name="reason" maxLength={500} /></label>
          </Composer>
        ) : <div className="sub">{ov.phase === "open" ? tx(locale, "The deadline for questions has passed.") : tx(locale, "Questions can only be asked while the event is open.")}</div>}
      </div>}

      {tab === "private" && <div>
        <p className="sub">{tx(locale, "Only you and the buyer can read this thread. Questions about the requirement belong on the question board.")}</p>
        {thread.requestDueAt && <div className="okbox">{tx(locale, "The buyer asked for a reply by {d}.", { d: fmt(thread.requestDueAt, locale) })}</div>}
        <Bubbles msgs={thread.messages} locale={locale} staffView={false} translate={trMsg} />
        {thread.messages.length === 0 && <div className="sub">{tx(locale, "No messages yet.")}</div>}
        {canWrite ? <Composer locale={locale} label={tx(locale, "Message to the buyer")} button={tx(locale, "Send message")} onSend={async (fd) => { const r = await supplierSendAction(eventId, fd); if (r.ok) await refresh(); return r; }} />
          : <div className="sub">{ov.phase === "closed" ? tx(locale, "You can reply only to a clarification request from the buyer, before its deadline.") : tx(locale, "Messages to the buyer are closed for this event.")}</div>}
      </div>}

      {tab === "notice" && <div>
        {ov.notices.length === 0 && <div className="sub">{tx(locale, "No notices yet.")}</div>}
        {ov.notices.map((n) => (
          <div key={n.id} className="bidcard">
            <div className="sub">{fmt(n.at, locale)}</div>
            <div className="body">{n.body}</div>
            <Translatable text={n.body} locale={locale} run={tr({ message: n.id })} />
            {n.files.length > 0 && <ul className="files">{n.files.map((f) => <li key={f.id}><a href={`/api/messages/files/${f.id}`}>{f.filename}</a></li>)}</ul>}
            {n.acknowledged ? <div className="okbox">{tx(locale, "Acknowledged")}</div> : <div className="actions"><button className="btn" type="button" onClick={async () => { await ackAction(eventId, n.id); await refresh(); }}>{tx(locale, "I have read this")}</button></div>}
          </div>
        ))}
      </div>}
    </div>
  );
}
