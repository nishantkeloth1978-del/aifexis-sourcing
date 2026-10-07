"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ComView } from "@/commercial/service";
import { approveAwardAction, openCommercialAction, recommendAction, rejectAwardAction, submitAwardAction } from "../../app/events/[id]/actions";

export default function CommercialPanel({ eventId, view }: { eventId: string; view: ComView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [witness, setWitness] = useState(view.witnesses[0]?.membershipId ?? "");
  const cmp = view.comparison;
  const [pick, setPick] = useState(cmp?.rows[0]?.supplierId ?? "");
  const [note, setNote] = useState("");
  const has = (r: string) => view.roles.includes(r);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null); setBusy(true);
    const res = await fn().catch(() => ({ ok: false, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!res.ok) { setError(("error" in res && res.error) || "That is not allowed."); return; }
    router.refresh();
  }
  const S = view.state;
  if (!["technical_approved", "commercial_evaluation", "recommended", "pending_award", "awarded"].includes(S)) return null;
  const awardedTo = view.recommendation?.name;

  return (
    <div className="card detail">
      <div className="row"><h3>Commercial evaluation and award</h3>{S === "awarded" && <span className="okbox" style={{ padding: "4px 10px" }}>Awarded</span>}</div>
      {error && <div className="alert" role="alert">{error}</div>}

      {S === "technical_approved" && has("buyer") && (view.witnesses.length === 0 ? <div className="sub">No witness is assigned to this event.</div> : (
        <div>
          <div className="sub">Opening the commercial envelopes reveals the prices of qualified bidders only. A witness must be present.</div>
          <div className="actions">
            <select value={witness} onChange={(e) => setWitness(e.target.value)} aria-label="Witness">{view.witnesses.map((w) => <option key={w.membershipId} value={w.membershipId}>{w.email}</option>)}</select>
            <button className="btn" type="button" disabled={busy || !witness} onClick={() => run(() => openCommercialAction(eventId, view.stateVersion, witness))}>{busy ? "Opening..." : "Open commercial envelopes"}</button>
          </div>
        </div>))}
      {S === "technical_approved" && !has("buyer") && <div className="sub">Waiting for the buyer to open the commercial envelopes.</div>}

      {cmp && (
        <>
          {cmp.closeResult && <div className="alert" style={{ background: "#fff4e0", color: "#8a5200" }}>Close result: the top two scores are less than 2 points apart. Review the reason carefully.</div>}
          <div className="sub">Score = {cmp.weights.technical}% technical + {cmp.weights.commercial}% commercial (lowest price / bid price x 100). Currency {cmp.currency}.{view.stored && " Stored calculation."}</div>
          <div className="tablewrap"><table className="items"><thead><tr>{(S === "commercial_evaluation") && has("buyer") && <th></th>}<th>#</th><th>Supplier</th><th className="num">Technical</th><th className="num">Total price</th><th className="num">Commercial</th><th className="num">Final</th></tr></thead><tbody>
            {cmp.rows.map((r) => (
              <tr key={r.supplierId}>{(S === "commercial_evaluation") && has("buyer") && <td><input type="radio" name="rec" checked={pick === r.supplierId} onChange={() => setPick(r.supplierId)} aria-label={`Recommend ${r.name}`} /></td>}
                <td>{r.rank}</td><td>{r.name}{view.recommendation?.supplierId === r.supplierId && <span className="sub"> (recommended)</span>}</td>
                <td className="num">{r.tech}</td><td className="num">{r.total}</td><td className="num">{r.commercial}</td><td className="num"><b>{r.final}</b></td></tr>
            ))}
          </tbody></table></div>
          {cmp.lines.length > 0 && (
            <details><summary>Price by line</summary>
              <div className="tablewrap"><table className="items"><thead><tr><th>#</th><th>Item</th>{cmp.rows.map((r) => <th key={r.supplierId} className="num">{r.name}</th>)}</tr></thead><tbody>
                {cmp.lines.map((l) => <tr key={l.lineNo}><td>{l.lineNo}</td><td>{l.description} <span className="sub">{l.quantity} {l.unit}</span></td>{cmp.rows.map((r) => <td key={r.supplierId} className="num">{l.byBid[r.supplierId]?.unitPrice ?? "-"}<div className="sub">{l.byBid[r.supplierId]?.amount ?? "-"}</div></td>)}</tr>)}
              </tbody></table></div></details>)}
        </>
      )}

      {S === "commercial_evaluation" && has("buyer") && cmp && (
        <div className="newform" style={{ margin: 0 }}>
          <label>Reason for the recommendation<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this bidder? Mention any deviation from the top-ranked bid." /></label>
          <div className="actions"><button className="btn" type="button" disabled={busy || !pick || note.trim().length < 10} onClick={() => run(() => recommendAction(eventId, view.stateVersion, pick, note))}>{busy ? "Saving..." : "Record recommendation"}</button></div>
        </div>
      )}

      {view.recommendation && ["recommended", "pending_award", "awarded"].includes(S) && (
        <div className="bidcard"><div><b>Recommendation:</b> {view.recommendation.name}</div><div className="bidtext">{view.recommendation.note}</div></div>
      )}

      {S === "recommended" && has("buyer") && <div className="actions"><button className="btn" type="button" disabled={busy} onClick={() => run(() => submitAwardAction(eventId, view.stateVersion))}>{busy ? "Submitting..." : "Submit for award approval"}</button></div>}
      {S === "pending_award" && (
        <div>
          <div className="sub">Award approvals: {view.approvals.done} of {view.approvals.required}.</div>
          {has("award_approver") && !view.approvals.mine && (
            <div className="actions">
              <button className="btn" type="button" disabled={busy} onClick={() => run(() => approveAwardAction(eventId, view.stateVersion))}>{busy ? "Saving..." : "Approve award"}</button>
              <button className="btn ghost" type="button" disabled={busy} onClick={() => run(() => rejectAwardAction(eventId, view.stateVersion))}>Send back</button>
            </div>)}
          {view.approvals.mine && <div className="sub">You have approved. Waiting for the other approvers.</div>}
        </div>
      )}
      {S === "awarded" && awardedTo && <div className="okbox">Awarded to {awardedTo}.</div>}
    </div>
  );
}
