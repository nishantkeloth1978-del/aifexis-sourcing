"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Thread } from "@/clarifications/service";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { answerAction } from "../../app/events/[id]/actions";

export default function StaffClarifications({ eventId, threads, canAnswer, open, locale = "en" }: { eventId: string; threads: Thread[]; canAnswer: boolean; open: boolean; locale?: Locale }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [share, setShare] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(id: string) {
    setError(null); setBusy(id);
    const r = await answerAction(eventId, id, drafts[id] ?? "", !!share[id]).catch(() => ({ ok: false, error: "That could not be saved. Try again." }));
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "That is not allowed."); return; }
    router.refresh();
  }
  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Clarifications")}</h3><span className="sub">{threads.length}</span></div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      {threads.length === 0 && <div className="sub">{tx(locale, "No questions from suppliers.")}</div>}
      {threads.map((t) => (
        <div key={t.id} className="bidcard">
          <div><span className="sub">{t.asker}</span><div><b>{tx(locale, "Q:")}</b> {t.question}</div></div>
          {t.answer ? <div className="bidtext"><b>{t.answer.shared ? tx(locale, "A (shared with all bidders):") : tx(locale, "A:")}</b> {t.answer.body}</div>
            : canAnswer && open ? (
              <div className="newform" style={{ margin: 0 }}>
                <textarea rows={2} placeholder={tx(locale, "Your answer")} value={drafts[t.id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))} />
                <label style={{ flexDirection: "row", alignItems: "center", fontWeight: 500 }}><input type="checkbox" checked={!!share[t.id]} onChange={(e) => setShare((s) => ({ ...s, [t.id]: e.target.checked }))} style={{ width: "auto" }} /> {tx(locale, "Share this answer with all bidders (the asker is not named)")}</label>
                <div className="actions"><button className="btn" type="button" disabled={busy === t.id || (drafts[t.id] ?? "").trim().length < 2} onClick={() => send(t.id)}>{busy === t.id ? tx(locale, "Sending...") : tx(locale, "Send answer")}</button></div>
              </div>) : <div className="sub">{tx(locale, "Not answered yet.")}</div>}
        </div>
      ))}
    </div>
  );
}
