"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { CheckScreen } from "@/bids/bidcheck";
import { dismissCheckAction, requestClarificationAction, runBidCheckAction } from "../../app/events/[id]/bid-check/actions";

const KIND: Record<string, string> = { price_missing: "Price missing", currency: "Currency", gate_declined: "Declaration declined", price_outlier: "Price far from the others", exclusion: "Exclusion", deviation: "Deviation", condition: "Condition", alternative: "Alternative offered", missing_info: "Requirement not addressed", unclear: "Unclear" };
const STATE: Record<string, string> = { open: "Open", asked: "Supplier asked", resolved: "Resolved", dismissed: "Dismissed" };

/** Findings per bid from fixed rules and the bid reader. The buyer decides: dismiss, or send selected points to the supplier as one private message. */
export default function BidCheckPanel({ locale, eventId, screen }: { locale: Locale; eventId: string; screen: CheckScreen }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string[]>>({}); const [days, setDays] = useState(3);
  const toggle = (sup: string, id: string) => setPicked((p) => ({ ...p, [sup]: (p[sup] ?? []).includes(id) ? (p[sup] ?? []).filter((x) => x !== id) : [...(p[sup] ?? []), id] }));
  async function run() {
    setBusy(true); setError(null); setInfo(null);
    const r = await runBidCheckAction(eventId).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setInfo(`${r.rules} ${tx(locale, "rule findings")} · ${r.reader} ${tx(locale, "from the reader")}${r.skipped ? ` · ${r.skipped} ${tx(locale, "bids not read")}` : ""}${r.note ? ` · ${tx(locale, r.note)}` : ""}`);
    router.refresh();
  }
  async function ask(sup: string) {
    setBusy(true); setError(null);
    const r = await requestClarificationAction(eventId, sup, picked[sup] ?? [], days).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setPicked((p) => ({ ...p, [sup]: [] })); router.refresh();
  }
  async function dismiss(id: string) { setBusy(true); const r = await dismissCheckAction(eventId, id).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." })); setBusy(false); if (!r.ok) setError(r.error); router.refresh(); }
  return (
    <div style={{ maxWidth: 900 }}>
      <div className="card detail">
        <div className="sub">{tx(locale, "Checks every bid you are allowed to see. Fixed rules look at prices, currency and declarations. If a Claude key is set, a reader also lists exclusions, deviations and conditions in the supplier's own words. Attached files are not read yet. You decide what to do with each point; nothing is sent to a supplier unless you send it.")}</div>
        {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
        {info && <div className="alert" role="status">{info}</div>}
        {screen.sealed && <div className="alert" role="status">{tx(locale, "There is nothing to check yet. Bids can be checked after the envelopes are opened.")}</div>}
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <button className="btn" disabled={busy || screen.sealed} onClick={run}>{busy ? tx(locale, "Checking…") : tx(locale, "Check the bids")}</button>
          {screen.usage && <span className="sub">{tx(locale, "AI reads today")}: {screen.usage.used} / {screen.usage.limit}</span>}
          {!screen.aiOn && <span className="sub">{tx(locale, "Without a Claude key only the fixed rules run.")}</span>}
        </div>
      </div>
      {screen.suppliers.length === 0 && !screen.sealed && <div className="card">{tx(locale, "No findings yet.")}</div>}
      {screen.suppliers.map((s) => {
        const rows = screen.rows.filter((r) => r.supplierId === s.id);
        const open = rows.filter((r) => r.state === "open");
        const t = screen.terms[s.id];
        return (
          <div className="card detail" key={s.id}>
            <h3>{s.name}</h3>
            {t && (t.incoterm || t.paymentTerms || t.validityDays || t.deliveryDays || t.warranty) && (
              <div className="sub">{tx(locale, "Terms stated")}: {[t.incoterm, t.paymentTerms, t.validityDays ? `${t.validityDays} ${tx(locale, "days validity")}` : null, t.deliveryDays ? `${t.deliveryDays} ${tx(locale, "days delivery")}` : null, t.warranty].filter(Boolean).join(" · ")}</div>)}
            <table className="table"><thead><tr><th /><th>{tx(locale, "Finding")}</th><th>{tx(locale, "Line")}</th><th>{tx(locale, "Detail")}</th><th>{tx(locale, "Status")}</th><th /></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.state === "open" && <input type="checkbox" aria-label={tx(locale, "Select")} checked={(picked[s.id] ?? []).includes(r.id)} onChange={() => toggle(s.id, r.id)} />}</td>
                  <td>{tx(locale, KIND[r.kind] ?? r.kind)}{r.source === "reader" ? " · AI" : ""}</td><td>{r.lineNo ?? "-"}</td>
                  <td>{r.detail}{r.quote && <blockquote style={{ margin: "4px 0 0" }}>&ldquo;{r.quote}&rdquo;</blockquote>}</td>
                  <td>{tx(locale, STATE[r.state] ?? r.state)}</td>
                  <td>{r.state === "open" && <button className="btn ghost" disabled={busy} onClick={() => dismiss(r.id)}>{tx(locale, "Dismiss")}</button>}</td></tr>))}</tbody></table>
            {open.length > 0 && (
              <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label>{tx(locale, "Reply needed within (days)")}<input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 70 }} /></label>
                <button className="btn" disabled={busy || !(picked[s.id] ?? []).length} onClick={() => ask(s.id)}>{tx(locale, "Ask the supplier about the selected points")}</button>
              </div>)}
          </div>);
      })}
    </div>
  );
}
