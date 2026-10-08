"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { ComView, LotComparison } from "@/commercial/service";
import { approveAwardAction, openCommercialAction, recommendAction, rejectAwardAction, submitAwardAction } from "../../app/events/[id]/actions";

export default function CommercialPanel({ eventId, view, locale = "en" }: { eventId: string; view: ComView; locale?: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [witness, setWitness] = useState(view.witnesses[0]?.membershipId ?? "");
  const cmp = view.comparison;
  const [pick, setPick] = useState(cmp?.rows[0]?.supplierId ?? "");
  // With lots: one pick per lot that has bids, starting from the top-ranked supplier of each lot.
  const parts: (Pick<LotComparison, "lotId" | "lotNo" | "name" | "rows" | "lines" | "closeResult">)[] = cmp ? (cmp.lots ?? [{ lotId: "", lotNo: 0, name: "", rows: cmp.rows, lines: cmp.lines, closeResult: cmp.closeResult }]) : [];
  const lotted = Boolean(cmp?.lots);
  const [picks, setPicks] = useState<Record<string, string>>(() => Object.fromEntries((cmp?.lots ?? []).filter((l) => l.rows.length).map((l) => [l.lotId, l.rows[0]!.supplierId])));
  const [note, setNote] = useState("");
  const has = (r: string) => view.roles.includes(r);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null); setBusy(true);
    const res = await fn().catch(() => ({ ok: false, error: tx(locale, "That could not be saved. Try again.") }));
    setBusy(false);
    if (!res.ok) { setError(("error" in res && res.error) || tx(locale, "That is not allowed.")); return; }
    router.refresh();
  }
  const S = view.state;
  if (!["technical_approved", "commercial_evaluation", "recommended", "pending_award", "awarded"].includes(S)) return null;
  const awardedTo = lotted && view.lotAwards.length ? view.lotAwards.map((a) => `${a.name} (${tx(locale, "Lot {n}", { n: a.lotNo })})`).join(", ") : view.recommendation?.name;
  const canPick = has("buyer") && (S === "commercial_evaluation" || S === "recommended");
  const pickComplete = lotted ? parts.every((l) => l.rows.length === 0 || picks[l.lotId]) && parts.some((l) => l.rows.length > 0) : Boolean(pick);

  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Commercial evaluation and award")}</h3>{S === "awarded" && <span className="okbox" style={{ padding: "4px 10px" }}>{tx(locale, "Awarded")}</span>}</div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}

      {S === "technical_approved" && has("buyer") && (view.witnesses.length === 0 ? <div className="sub">{tx(locale, "No witness is assigned to this event.")}</div> : (
        <div>
          <div className="sub">{tx(locale, "Opening the commercial envelopes reveals the prices of qualified bidders only. A witness must be present.")}</div>
          <div className="actions">
            <select value={witness} onChange={(e) => setWitness(e.target.value)} aria-label={tx(locale, "Witness")}>{view.witnesses.map((w) => <option key={w.membershipId} value={w.membershipId}>{w.email}</option>)}</select>
            <button className="btn" type="button" disabled={busy || !witness} onClick={() => run(() => openCommercialAction(eventId, view.stateVersion, witness))}>{busy ? tx(locale, "Opening...") : tx(locale, "Open commercial envelopes")}</button>
          </div>
        </div>))}
      {S === "technical_approved" && !has("buyer") && <div className="sub">{tx(locale, "Waiting for the buyer to open the commercial envelopes.")}</div>}

      {cmp && (
        <>
          <div className="sub">{tx(locale, "Score = {t}% technical + {c}% commercial (lowest price / bid price x 100). Currency {cur}.", { t: cmp.weights.technical, c: cmp.weights.commercial, cur: cmp.currency })}{view.stored && " " + tx(locale, "Stored calculation.")}{lotted && " " + tx(locale, "Each lot is ranked on its own.")}</div>
          {parts.map((part) => (
            <div key={part.lotId || "all"}>
              {lotted && <h4 style={{ margin: "14px 0 4px" }}>{tx(locale, "Lot {n}", { n: part.lotNo })}: {part.name}</h4>}
              {part.closeResult && <div className="alert" style={{ background: "#fff4e0", color: "#8a5200" }}>{tx(locale, "Close result: the top two scores are less than 2 points apart. Review the reason carefully.")}</div>}
              {part.rows.length === 0 ? <div className="sub">{tx(locale, "No qualified bids for this lot.")}</div> : (<>
                <div className="tablewrap"><table className="items"><thead><tr>{canPick && <th></th>}<th>#</th><th>{tx(locale, "Supplier")}</th><th className="num">{tx(locale, "Technical")}</th><th className="num">{tx(locale, "Total price")}</th><th className="num">{tx(locale, "Commercial")}</th><th className="num">{tx(locale, "Final")}</th></tr></thead><tbody>
                  {part.rows.map((r) => {
                    const chosen = lotted ? view.lotAwards.some((a) => a.lotId === part.lotId && a.supplierId === r.supplierId) : view.recommendation?.supplierId === r.supplierId;
                    return (
                      <tr key={r.supplierId}>{canPick && <td><input type="radio" name={`rec-${part.lotId || "all"}`} checked={lotted ? picks[part.lotId] === r.supplierId : pick === r.supplierId} onChange={() => lotted ? setPicks((x) => ({ ...x, [part.lotId]: r.supplierId })) : setPick(r.supplierId)} aria-label={tx(locale, "Recommend {name}", { name: r.name })} /></td>}
                        <td>{r.rank}</td><td>{r.name}{chosen && <span className="sub"> {tx(locale, "(recommended)")}</span>}</td>
                        <td className="num">{r.tech}</td><td className="num">{r.total}</td><td className="num">{r.commercial}</td><td className="num"><b>{r.final}</b></td></tr>
                    );
                  })}
                </tbody></table></div>
                {part.lines.length > 0 && (
                  <details><summary>{tx(locale, "Price by line")}</summary>
                    <div className="tablewrap"><table className="items"><thead><tr><th>#</th><th>{tx(locale, "Item")}</th>{part.rows.map((r) => <th key={r.supplierId} className="num">{r.name}</th>)}</tr></thead><tbody>
                      {part.lines.map((l) => <tr key={l.lineNo}><td>{l.lineNo}</td><td>{l.description} <span className="sub">{l.quantity} {l.unit}</span></td>{part.rows.map((r) => <td key={r.supplierId} className="num">{l.byBid[r.supplierId]?.unitPrice ?? "-"}<div className="sub">{l.byBid[r.supplierId]?.amount ?? "-"}</div></td>)}</tr>)}
                    </tbody></table></div></details>)}
              </>)}
            </div>
          ))}
          <div className="actions" style={{ marginTop: 0 }}><a className="btn ghost" href={`/api/export/events/${eventId}`}>{tx(locale, "Export to Excel")}</a></div>
        </>
      )}

      {canPick && cmp && (
        <div className="newform" style={{ margin: 0 }}>
          <label>{tx(locale, "Reason for the recommendation")}<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx(locale, "Why this bidder? Mention any deviation from the top-ranked bid.")} /></label>
          <div className="actions"><button className="btn" type="button" disabled={busy || !pickComplete || note.trim().length < 10} onClick={() => run(() => recommendAction(eventId, view.stateVersion, lotted ? picks : pick, note))}>{busy ? tx(locale, "Saving...") : S === "recommended" ? tx(locale, "Change recommendation") : tx(locale, "Record recommendation")}</button></div>
        </div>
      )}

      {view.recommendation && ["recommended", "pending_award", "awarded"].includes(S) && (
        <div className="bidcard"><div><b>{tx(locale, "Recommendation:")}</b> {lotted && view.lotAwards.length ? view.lotAwards.map((a) => `${tx(locale, "Lot {n}", { n: a.lotNo })} (${a.lotName}): ${a.name}`).join("; ") : view.recommendation.name}</div><div className="bidtext">{view.recommendation.note}</div></div>
      )}

      {S === "recommended" && has("buyer") && <div className="actions"><button className="btn" type="button" disabled={busy} onClick={() => run(() => submitAwardAction(eventId, view.stateVersion))}>{busy ? tx(locale, "Submitting...") : tx(locale, "Submit for award approval")}</button></div>}
      {S === "pending_award" && (
        <div>
          <div className="sub">{tx(locale, "Award approvals: {done} of {required}.", { done: view.approvals.done, required: view.approvals.required })}</div>
          {has("award_approver") && !view.approvals.mine && (
            <div className="actions">
              <button className="btn" type="button" disabled={busy} onClick={() => run(() => approveAwardAction(eventId, view.stateVersion))}>{busy ? tx(locale, "Saving...") : tx(locale, "Approve award")}</button>
              <button className="btn ghost" type="button" disabled={busy} onClick={() => run(() => rejectAwardAction(eventId, view.stateVersion))}>{tx(locale, "Send back")}</button>
            </div>)}
          {view.approvals.mine && <div className="sub">{tx(locale, "You have approved. Waiting for the other approvers.")}</div>}
        </div>
      )}
      {["recommended", "pending_award", "awarded"].includes(S) && (has("buyer") || has("auditor") || has("award_approver")) && <div className="actions"><a className="btn ghost" href={`/events/${eventId}/pack`}>{tx(locale, "Open award pack")}</a></div>}
      {S === "awarded" && awardedTo && <div className="okbox">{tx(locale, "Awarded to {name}.", { name: awardedTo })}</div>}
    </div>
  );
}
