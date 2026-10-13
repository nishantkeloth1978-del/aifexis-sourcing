"use client";
import { useState } from "react";
import { tx } from "@/i18n/tx";
import DecisionGate from "./DecisionGate";
import type { Locale } from "@/i18n/dict";
import type { CancelInfo } from "@/events/cancel";
import { cancelEventAction } from "../../app/events/[id]/actions";

export default function CancelPanel({ locale = "en", eventId, version, info }: { locale?: Locale; eventId: string; version: number; info: CancelInfo }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (info.cancelledAt) return <div className="card detail"><div className="row"><h3>{tx(locale, "Event cancelled")}</h3></div><div className="sub">{info.cancelledAt.slice(0, 10)}</div><div className="bidtext">{info.reason}</div></div>;
  if (!info.canCancel) return null;
  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Cancel this event")}</h3></div>
      {!open ? <button className="btn ghost" type="button" style={{ color: "var(--red, #b42318)" }} onClick={() => setOpen(true)}>{tx(locale, "Cancel the event...")}</button> : (
        <div className="newform" style={{ margin: 0 }}>
          <p className="sub">{tx(locale, "Suppliers are told the event is cancelled and no award will be made. Bids and evaluation stay on record. This cannot be undone.")}</p>
          <label>{tx(locale, "Reason")}<textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></label>
          <label>{tx(locale, "Award approver who agrees")}<select value={approver} onChange={(e) => setApprover(e.target.value)}>
            <option value="">{tx(locale, "Choose a person")}</option>
            {info.approvers.map((a) => <option key={a.membershipId} value={a.membershipId}>{a.email}</option>)}</select></label>
          {err && <div className="alert" role="alert">{tx(locale, err)}</div>}
          <DecisionGate locale={locale} eventId={eventId} version={version} command="CancelEvent" secondId={approver} secondEmail={info.approvers.find((a) => a.membershipId === approver)?.email ?? ""}
            payload={{ approvedByMembershipId: approver, cancelReason: reason.trim() }} request={info.request} ready={reason.trim().length >= 10}
            runLabel={tx(locale, "Cancel the event")} busyLabel={tx(locale, "Saving...")} onRun={() => cancelEventAction(eventId, version, reason.trim(), approver)} />
          <div className="actions"><button className="btn ghost" type="button" onClick={() => setOpen(false)}>{tx(locale, "Keep the event")}</button></div>
        </div>)}
    </div>
  );
}
