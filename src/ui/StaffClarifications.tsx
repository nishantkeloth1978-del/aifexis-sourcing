"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Thread } from "@/clarifications/service";
import { answerAction } from "../../app/events/[id]/actions";

export default function StaffClarifications({ eventId, threads, canAnswer, open }: { eventId: string; threads: Thread[]; canAnswer: boolean; open: boolean }) {
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
      <div className="row"><h3>Clarifications</h3><span className="sub">{threads.length}</span></div>
      {error && <div className="alert" role="alert">{error}</div>}
      {threads.length === 0 && <div className="sub">No questions from suppliers.</div>}
      {threads.map((t) => (
        <div key={t.id} className="bidcard">
          <div><span className="sub">{t.asker}</span><div><b>Q:</b> {t.question}</div></div>
          {t.answer ? <div className="bidtext"><b>A{t.answer.shared ? " (shared with all bidders)" : ""}:</b> {t.answer.body}</div>
            : canAnswer && open ? (
              <div className="newform" style={{ margin: 0 }}>
                <textarea rows={2} placeholder="Your answer" value={drafts[t.id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))} />
                <label style={{ flexDirection: "row", alignItems: "center", fontWeight: 500 }}><input type="checkbox" checked={!!share[t.id]} onChange={(e) => setShare((s) => ({ ...s, [t.id]: e.target.checked }))} style={{ width: "auto" }} /> Share this answer with all bidders (the asker is not named)</label>
                <div className="actions"><button className="btn" type="button" disabled={busy === t.id || (drafts[t.id] ?? "").trim().length < 2} onClick={() => send(t.id)}>{busy === t.id ? "Sending..." : "Send answer"}</button></div>
              </div>) : <div className="sub">Not answered yet.</div>}
        </div>
      ))}
    </div>
  );
}
