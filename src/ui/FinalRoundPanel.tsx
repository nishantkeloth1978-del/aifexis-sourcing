"use client";
import { useState } from "react";
import { tx } from "@/i18n/tx";
import DecisionGate from "./DecisionGate";
import type { Locale } from "@/i18n/dict";
import type { RoundInfo } from "@/events/rounds";
import { startFinalRoundAction } from "../../app/approvers/actions";

export default function FinalRoundPanel({ locale, eventId, version, info }: { locale: Locale; eventId: string; version: number; info: RoundInfo }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<Record<string, boolean>>(Object.fromEntries(info.candidates.filter((c) => c.qualified).map((c) => [c.supplierId, true])));
  const [closes, setCloses] = useState("");
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState("");
  const chosen = Object.keys(pick).filter((k) => pick[k]).sort();
  const closesIso = closes && !Number.isNaN(new Date(closes).getTime()) ? new Date(closes).toISOString() : "";
  const name = (id: string) => info.candidates.find((c) => c.supplierId === id)?.name ?? id.slice(0, 8);
  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Final round")}</h3><span className="sub">{tx(locale, "Round {n}", { n: info.roundNo })}</span></div>
      {info.rounds.map((r) => (
        <p className="sub" key={r.roundNo}>{tx(locale, "Round {n}", { n: r.roundNo })} · {tx(locale, "{0} bidders invited", { "0": r.shortlist.length })} · {r.closesAt.slice(0, 16).replace("T", " ")} UTC · {r.reason}</p>
      ))}
      {info.canStart && !open && <button className="btn" type="button" onClick={() => setOpen(true)}>{tx(locale, "Start a final round")}</button>}
      {info.canStart && open && (
        <div className="stack">
          <p className="sub">{tx(locale, "Only the bidders you choose can revise their bids. Earlier revisions are kept. The envelopes are sealed again and evaluation restarts after this round closes.")}</p>
          <ul className="team">
            {info.candidates.map((c) => (
              <li key={c.supplierId}><label><input type="checkbox" checked={!!pick[c.supplierId]} onChange={(e) => setPick((p) => ({ ...p, [c.supplierId]: e.target.checked }))} /> {name(c.supplierId)}</label>
                <span className="sub">{c.qualified ? tx(locale, "Qualified") : tx(locale, "Not qualified")}</span></li>
            ))}
          </ul>
          <label>{tx(locale, "New closing time")} <input type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} required /></label>
          <label>{tx(locale, "Reason")} <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={1000} /></label>
          <label>{tx(locale, "Award approver who agrees")} <select value={approver} onChange={(e) => setApprover(e.target.value)} required>
            <option value="" disabled>{tx(locale, "Choose a person")}</option>
            {info.approvers.map((a) => <option key={a.membershipId} value={a.membershipId}>{a.email}</option>)}</select></label>
          <DecisionGate locale={locale} eventId={eventId} version={version} command="StartFinalRound" secondId={approver} secondEmail={info.approvers.find((a) => a.membershipId === approver)?.email ?? ""}
            payload={{ approvedByMembershipId: approver, finalRound: { shortlist: chosen, closesAt: closesIso, reason: reason.trim() } }} request={info.request} ready={Boolean(closesIso) && chosen.length > 0 && reason.trim().length >= 5}
            runLabel={tx(locale, "Open the final round")} busyLabel={tx(locale, "Saving...")}
            onRun={() => startFinalRoundAction(eventId, version, { shortlist: chosen, closesAt: closesIso, reason: reason.trim(), approverId: approver })} />
          <div><button className="btn ghost" type="button" onClick={() => setOpen(false)}>{tx(locale, "Cancel")}</button></div>
        </div>
      )}
    </div>
  );
}
