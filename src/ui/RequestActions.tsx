"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { convertRequestAction, rejectRequestAction, withdrawRequestAction } from "../../app/requests/actions";

export default function RequestActions({ locale, id, canHandle, mine }: { locale: Locale; id: string; canHandle: boolean; mine: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState(""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<{ ok: boolean; error?: string; eventId?: string }>) {
    setBusy(true); setError(null);
    const r: { ok: boolean; error?: string; eventId?: string } = await fn().catch(() => ({ ok: false, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "That could not be saved. Try again."); return; }
    if (r.eventId) router.push(`/events/${r.eventId}`); else router.refresh();
  }
  return (
    <div style={{ marginTop: 14 }}>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        {canHandle && <button className="btn" disabled={busy} onClick={() => run(() => convertRequestAction(id))}>{tx(locale, "Create draft event")}</button>}
        {mine && <button className="btn ghost" disabled={busy} onClick={() => run(() => withdrawRequestAction(id))}>{tx(locale, "Withdraw request")}</button>}
      </div>
      {canHandle && (
        <div className="newform" style={{ marginTop: 12 }}>
          <label>{tx(locale, "Reason, if not taken forward")}<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></label>
          <div><button className="btn ghost" disabled={busy} onClick={() => run(() => rejectRequestAction(id, note))}>{tx(locale, "Send back with this reason")}</button></div>
        </div>)}
    </div>
  );
}
