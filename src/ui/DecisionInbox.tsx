"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { DecisionRow } from "@/decisions/service";
import { decideAction } from "../../app/decisions/actions";

export default function DecisionInbox({ locale, rows }: { locale: Locale; rows: DecisionRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function answer(id: string, approve: boolean) {
    setBusy(id); setErr(null);
    const r = await decideAction(id, approve).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    router.refresh();
  }
  if (rows.length === 0) return <div className="card"><h3>{tx(locale, "Nothing to confirm")}</h3><div className="sub">{tx(locale, "When someone asks you to witness or approve a step, it appears here.")}</div></div>;
  return (
    <div className="stack">
      {err && <div className="alert" role="alert">{tx(locale, err)}</div>}
      {rows.map((r) => (
        <div className="card detail" key={r.id}>
          <div className="row"><h3>{tx(locale, r.label)}</h3><span className="sub">{r.eventRef}</span></div>
          <div className="sub">{r.eventTitle}</div>
          <p className="sub">{tx(locale, "Asked by {0}", { "0": r.requestedBy })} · {r.createdAt.slice(0, 16).replace("T", " ")} UTC</p>
          {r.detail && <div className="bidtext">{r.detail}</div>}
          {r.stale
            ? <div className="alert" role="alert">{tx(locale, "The event has changed since you were asked. Ask for a new request.")}</div>
            : <div className="actions">
                <button className="btn" type="button" disabled={busy === r.id} onClick={() => answer(r.id, true)}>{tx(locale, "Confirm")}</button>
                <button className="btn ghost" type="button" disabled={busy === r.id} onClick={() => answer(r.id, false)}>{tx(locale, "Decline")}</button>
                <Link className="btn ghost" href={`/events/${r.eventId}`}>{tx(locale, "View the event")}</Link>
              </div>}
        </div>
      ))}
    </div>
  );
}
