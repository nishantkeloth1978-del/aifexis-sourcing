"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { JourneyView } from "@/journey/service";
import { extendQuoteAction, releaseFeedbackAction, setValidityAction } from "../../app/events/[id]/actions";

export default function JourneyPanel({ eventId, view, locale = "en" }: { eventId: string; view: JourneyView; locale?: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(view.validityDays ? String(view.validityDays) : "");
  const [ext, setExt] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const buyer = view.roles.includes("buyer");
  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null); setBusy(true);
    const r = await fn().catch(() => ({ ok: false, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) { setError(("error" in r && r.error) || "That is not allowed."); return; }
    router.refresh();
  }
  const closed = ["awarded", "cancelled", "archived"].includes(view.state);
  const canExtend = buyer && !["draft", "pending_publication", "published", "awarded", "cancelled"].includes(view.state);
  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Quote validity and feedback")}</h3></div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      <div className="sub">{tx(locale, "Bids should stay valid for this many days after the closing date.")}</div>
      <div className="actions">
        <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} disabled={!buyer || closed} aria-label={tx(locale, "Validity in days")} placeholder={tx(locale, "Days, e.g. 90")} style={{ maxWidth: 120 }} />
        {buyer && !closed && <button className="btn" type="button" disabled={busy} onClick={() => run(() => setValidityAction(eventId, days.trim() ? Number(days) : null))}>{tx(locale, "Save validity")}</button>}
        {view.baseUntil && <span className="sub">{tx(locale, "Valid until {date}", { date: view.baseUntil })}</span>}
      </div>
      {view.bidders.length > 0 && view.bidders.some((b) => b.until) && (
        <div className="tablewrap"><table className="items"><thead><tr><th>{tx(locale, "Supplier")}</th><th>{tx(locale, "Valid until")}</th>{canExtend && <th>{tx(locale, "Record extension")}</th>}</tr></thead><tbody>
          {view.bidders.map((b) => (
            <tr key={b.supplierId}><td>{b.name}</td><td>{b.until ?? "-"}{b.extended && <span className="sub"> ({tx(locale, "extended")})</span>}{b.expired && <span className="alert" style={{ marginLeft: 8, padding: "2px 8px" }}>{tx(locale, "Expired")}</span>}</td>
              {canExtend && <td><span className="actions" style={{ margin: 0 }}><input type="date" value={ext[b.supplierId] ?? ""} onChange={(e) => setExt((x) => ({ ...x, [b.supplierId]: e.target.value }))} aria-label={tx(locale, "New valid-until date")} /><button className="btn ghost" type="button" disabled={busy || !ext[b.supplierId]} onClick={() => run(() => extendQuoteAction(eventId, b.supplierId, ext[b.supplierId]!))}>{tx(locale, "Save")}</button></span></td>}</tr>))}
        </tbody></table></div>)}
      {view.state === "awarded" && (
        <div>
          <h4 style={{ margin: "14px 0 4px" }}>{tx(locale, "Feedback to unsuccessful bidders")}</h4>
          {view.debriefs.length === 0 ? <div className="sub">{tx(locale, "There are no unsuccessful bidders.")}</div> : view.debriefs.map((d) => (
            <div key={d.supplierId} className="bidcard">
              <div><b>{d.name}</b> {d.released ? <span className="okbox" style={{ padding: "2px 8px" }}>{tx(locale, "Sent")}</span> : <span className="sub">{tx(locale, "Not sent")}</span>}</div>
              {d.released && !(msg[d.supplierId] !== undefined) ? <div className="bidtext">{d.released}</div> : null}
              {buyer && (
                <>
                  <textarea rows={4} value={msg[d.supplierId] ?? d.released ?? d.suggested} onChange={(e) => setMsg((x) => ({ ...x, [d.supplierId]: e.target.value }))} aria-label={tx(locale, "Feedback message")} />
                  <div className="sub">{tx(locale, "Shows this bidder its own scores only. Other bidders' prices are never included.")}</div>
                  <div className="actions"><button className="btn" type="button" disabled={busy} onClick={() => run(() => releaseFeedbackAction(eventId, d.supplierId, msg[d.supplierId] ?? d.released ?? d.suggested))}>{d.released ? tx(locale, "Update feedback") : tx(locale, "Send feedback")}</button></div>
                </>)}
            </div>))}
        </div>)}
    </div>
  );
}
