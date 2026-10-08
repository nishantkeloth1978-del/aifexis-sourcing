"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { EvalView } from "@/evaluation/service";
import { approveTechnicalAction, closeBiddingAction, openEnvelopesAction, saveScoresAction } from "../../app/events/[id]/actions";

export default function EvaluationPanel({ eventId, view, locale = "en" }: { eventId: string; view: EvalView; locale?: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [witness, setWitness] = useState(view.witnesses[0]?.membershipId ?? "");
  const [scores, setScores] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(Object.entries(view.myScores).map(([s, m]) => [s, Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)]))])));
  const [savedFor, setSavedFor] = useState<Record<string, boolean>>(() => Object.fromEntries(Object.keys(view.myScores).map((s) => [s, true])));
  const [picked, setPicked] = useState<Record<string, boolean>>(() => Object.fromEntries((view.results ?? []).map((r) => [r.supplierId, r.suggested])));

  const has = (r: string) => view.roles.includes(r);
  const canClose = view.state === "published" && has("buyer");
  const deadlineReached = view.closesAt ? new Date(view.closesAt).getTime() <= Date.now() : false;
  const isEvaluator = has("tech_evaluator");

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null); setBusy(true);
    const res = await fn().catch(() => ({ ok: false, error: tx(locale, "That could not be saved. Try again.") }));
    setBusy(false);
    if (!res.ok) { setError(("error" in res && res.error) || tx(locale, "That is not allowed.")); return false; }
    router.refresh(); return true;
  }
  async function saveOne(supplierId: string) {
    const raw = scores[supplierId] ?? {};
    const parsed: Record<string, number> = {};
    for (const k of view.criteria) parsed[k] = raw[k] === undefined || raw[k] === "" ? NaN : Number(raw[k]);
    setSavedFor((s) => ({ ...s, [supplierId]: true }));      // shown as saved at once
    const ok = await run(() => saveScoresAction(eventId, supplierId, parsed));
    if (!ok) setSavedFor((s) => ({ ...s, [supplierId]: false }));
  }

  if (view.state === "draft" || view.state === "pending_publication") return null;
  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Bids and evaluation")}</h3>{view.bidderCount !== null && <span className="sub">{view.bidderCount === 1 ? tx(locale, "1 bidder") : tx(locale, "{n} bidders", { n: view.bidderCount })}</span>}</div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}

      {view.state === "published" && (
        <div className="sub">{tx(locale, "Bids are sealed until the event is closed and the technical envelopes are opened with a witness.")}
          {canClose && <div className="actions"><button className="btn" type="button" disabled={busy}
            onClick={() => { if (deadlineReached || window.confirm(tx(locale, "The closing time has not been reached yet. Close bidding now? Suppliers will no longer be able to bid."))) run(() => closeBiddingAction(eventId, view.stateVersion)); }}>{busy ? tx(locale, "Closing...") : tx(locale, "Close bidding")}</button></div>}
        </div>
      )}

      {view.state === "closed" && (
        <div>
          <div className="sub">{tx(locale, "Bidding is closed. Opening the technical envelopes needs a witness who is on this event.")}</div>
          {has("buyer") && (view.witnesses.length === 0 ? <div className="sub">{tx(locale, "No witness is assigned to this event.")}</div> : (
            <div className="actions">
              <select value={witness} onChange={(e) => setWitness(e.target.value)} aria-label={tx(locale, "Witness")}>{view.witnesses.map((w) => <option key={w.membershipId} value={w.membershipId}>{w.email}</option>)}</select>
              <button className="btn" type="button" disabled={busy || !witness} onClick={() => run(() => openEnvelopesAction(eventId, view.stateVersion, witness))}>{busy ? tx(locale, "Opening...") : tx(locale, "Open technical envelopes")}</button>
            </div>))}
        </div>
      )}

      {view.state === "technical_evaluation" && (
        <>
          {!view.bidders ? <div className="sub">{tx(locale, "Technical envelopes are open. You do not have access to the technical responses.")}</div> : view.bidders.map((b) => (
            <div key={b.supplierId} className="bidcard">
              <div className="row"><b>{b.name}</b><span className="sub">{tx(locale, "Revision {n}", { n: b.revisionNo })}</span></div>
              {b.failed.length > 0 && <div className="alert" role="alert">{tx(locale, "Disqualified: {reasons}", { reasons: b.failed.map((f) => tx(locale, f)).join("; ") })}</div>}
              {b.gates.length > 0 && <div className="sub">{b.gates.map((g) => <div key={g.name} style={{ color: g.answer ? undefined : "#b42318", fontWeight: g.answer ? undefined : 600 }}>{g.answer ? tx(locale, "Yes") : tx(locale, "No")}: {g.name}</div>)}</div>}
              <div className="bidtext">{b.technicalText}</div>
              {isEvaluator && (
                <div className="scoregrid">
                  {view.criteria.map((k, i) => (
                    <label key={k}>{k}{view.criterionWeights ? ` (${view.criterionWeights[i]}%)` : ""}<input inputMode="decimal" placeholder={tx(locale, "0 to 10")} value={scores[b.supplierId]?.[k] ?? ""}
                      onChange={(e) => { setSavedFor((s) => ({ ...s, [b.supplierId]: false })); setScores((s) => ({ ...s, [b.supplierId]: { ...s[b.supplierId], [k]: e.target.value } })); }} /></label>
                  ))}
                  <button className="btn ghost" type="button" disabled={busy} onClick={() => saveOne(b.supplierId)}>{savedFor[b.supplierId] ? tx(locale, "Saved") : tx(locale, "Save scores")}</button>
                </div>
              )}
            </div>
          ))}
          {view.results && (
            <div>
              <h3>{tx(locale, "Technical result")}</h3>
              <div className="sub">{tx(locale, "Out of 100. Tick the bidders that qualify (suggested: {q} or more).", { q: view.qualifyAt })}</div>
              <div className="tablewrap"><table className="items"><thead><tr><th>{tx(locale, "Qualifies")}</th><th>{tx(locale, "Supplier")}</th><th className="num">{tx(locale, "Score")}</th><th className="num">{tx(locale, "Evaluators")}</th></tr></thead><tbody>
                {view.results.map((r) => (
                  <tr key={r.supplierId}><td><input type="checkbox" disabled={!!r.disqualified} checked={!!picked[r.supplierId] && !r.disqualified} onChange={(e) => setPicked((p) => ({ ...p, [r.supplierId]: e.target.checked }))} /></td>
                    <td>{r.name}{r.disqualified && <span className="pill" style={{ marginLeft: 8, color: "#b42318" }}>{tx(locale, "Disqualified")}</span>}</td><td className="num">{r.total ?? "-"}</td><td className="num">{r.evaluators}</td></tr>
                ))}
              </tbody></table></div>
              {has("tech_approver") && <div className="actions"><button className="btn" type="button" disabled={busy}
                onClick={() => run(() => approveTechnicalAction(eventId, view.stateVersion, Object.keys(picked).filter((k) => picked[k] && !view.results?.find((r) => r.supplierId === k)?.disqualified)))}>{busy ? tx(locale, "Approving...") : tx(locale, "Approve technical result")}</button></div>}
            </div>
          )}
        </>
      )}

      {["technical_approved", "commercial_evaluation", "recommended", "pending_award", "awarded"].includes(view.state) && view.results && (
        <div>
          <h3>{tx(locale, "Technical result")}</h3>
          <div className="tablewrap"><table className="items"><thead><tr><th>{tx(locale, "Supplier")}</th><th className="num">{tx(locale, "Score")}</th><th>{tx(locale, "Result")}</th></tr></thead><tbody>
            {view.results.map((r) => <tr key={r.supplierId}><td>{r.name}</td><td className="num">{r.total}</td><td>{r.qualified ? tx(locale, "Qualified") : tx(locale, "Not qualified")}</td></tr>)}
          </tbody></table></div>
        </div>
      )}
    </div>
  );
}
