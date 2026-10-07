"use client";
import { useState } from "react";
import type { Thread } from "@/clarifications/service";
import { askQuestionAction } from "../../app/supplier/events/[id]/actions";

export default function SupplierQuestions({ eventId, initial, canAsk }: { eventId: string; initial: Thread[]; canAsk: boolean }) {
  const [threads, setThreads] = useState<(Thread & { pending?: boolean })[]>(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function send(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const q = text.trim(); if (q.length < 5) { setError("Write your question (at least 5 characters)."); return; }
    const temp = { id: "tmp-" + Date.now(), question: q, asker: null, askedAt: new Date().toISOString(), answer: null, pending: true };
    setThreads((t) => [...t, temp]); setText("");                         // shown at once
    askQuestionAction(eventId, q).then((r) => {
      if (r.ok) setThreads((t) => t.map((x) => (x.id === temp.id ? { ...x, pending: false } : x)));
      else { setThreads((t) => t.filter((x) => x.id !== temp.id)); setText(q); setError(r.error ?? "That could not be sent."); }
    }).catch(() => { setThreads((t) => t.filter((x) => x.id !== temp.id)); setText(q); setError("That could not be sent. Try again."); });
  }
  return (
    <div className="card detail">
      <h3>Questions to the buyer</h3>
      {error && <div className="alert" role="alert">{error}</div>}
      {threads.length === 0 && <div className="sub">No questions yet.</div>}
      {threads.map((t) => (
        <div key={t.id} className="bidcard" style={t.pending ? { opacity: 0.6 } : undefined}>
          <div>{t.fromOthers && <span className="sub">Answer shared with all bidders. </span>}<b>Q:</b> {t.question}</div>
          {t.answer ? <div className="bidtext"><b>A:</b> {t.answer.body}</div> : <div className="sub">Waiting for the buyer's answer.</div>}
        </div>
      ))}
      {canAsk && (
        <form onSubmit={send} className="newform" style={{ margin: 0 }}>
          <label>Ask a question<textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} /></label>
          <div className="sub">Your question goes to the buyer only. The buyer may share the answer with all bidders without naming you.</div>
          <div className="actions"><button className="btn" type="submit" disabled={text.trim().length < 5}>Send question</button></div>
        </form>
      )}
    </div>
  );
}
