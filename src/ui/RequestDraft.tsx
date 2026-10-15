"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { DraftItem } from "@/requests/service";
import { acceptDraftAction, discardDraftAction, draftRequestAction } from "../../app/requests/actions";

interface Draft { title: string; items: DraftItem[]; notes: string[] }

/** Gate 1: the AI proposes a draft event from the request; the buyer reads it, changes what is wrong, and creates the draft event, or discards it. */
export default function RequestDraft({ locale, requestId, initial, usage }: { locale: Locale; requestId: string; initial: { runId: string; draft: Draft } | null; usage: { used: number; limit: number } | null }) {
  const router = useRouter();
  const [run, setRun] = useState<string | null>(initial?.runId ?? null);
  const [draft, setDraft] = useState<Draft | null>(initial?.draft ?? null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const setItem = (i: number, patch: Partial<DraftItem>) => setDraft((d) => d && { ...d, items: d.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  async function ask() {
    setBusy(true); setError(null);
    const r = await draftRequestAction(requestId).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (r.ok) { setRun(r.runId); setDraft(r.draft); } else setError(r.error);
  }
  async function accept() {
    if (!run || !draft) return; setBusy(true); setError(null);
    const r = await acceptDraftAction(run, draft).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (r.ok) router.push(`/events/${r.eventId}`); else setError(r.error);
  }
  async function discard() {
    if (!run) return; setBusy(true);
    await discardDraftAction(run).catch(() => undefined);
    setBusy(false); setRun(null); setDraft(null); router.refresh();
  }
  return (
    <div className="newform" style={{ marginTop: 14 }}>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      {!draft && (
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <button className="btn ghost" type="button" disabled={busy} onClick={ask}>{busy ? tx(locale, "Drafting…") : tx(locale, "Draft with AI")}</button>
          {usage && <span className="sub">{tx(locale, "AI drafts today")}: {usage.used} / {usage.limit}</span>}
        </div>)}
      {draft && (
        <div className="card" aria-label={tx(locale, "AI draft for review")}>
          <div className="sub">{tx(locale, "This draft was written by AI from the request. Check it, change what is wrong, then create the draft event. Nothing is published until the normal approval.")}</div>
          {draft.notes.length > 0 && <div className="alert" role="status"><b>{tx(locale, "To confirm")}:</b><ul>{draft.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}
          <label>{tx(locale, "Title")}<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200} /></label>
          <table className="table"><thead><tr><th>#</th><th>{tx(locale, "Description")}</th><th>{tx(locale, "Quantity")}</th><th>{tx(locale, "Unit")}</th><th>{tx(locale, "Specification")}</th></tr></thead>
            <tbody>{draft.items.map((it, i) => (
              <tr key={i}><td>{i + 1}</td>
                <td><input aria-label={tx(locale, "Description")} value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} maxLength={500} /></td>
                <td><input aria-label={tx(locale, "Quantity")} value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} size={8} /></td>
                <td><input aria-label={tx(locale, "Unit")} value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} size={6} maxLength={20} /></td>
                <td><input aria-label={tx(locale, "Specification")} value={it.specification ?? ""} onChange={(e) => setItem(i, { specification: e.target.value })} maxLength={1000} /></td></tr>))}</tbody></table>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn" type="button" disabled={busy} onClick={accept}>{tx(locale, "Create draft event from this")}</button>
            <button className="btn ghost" type="button" disabled={busy} onClick={discard}>{tx(locale, "Discard the draft")}</button>
          </div>
        </div>)}
    </div>
  );
}
