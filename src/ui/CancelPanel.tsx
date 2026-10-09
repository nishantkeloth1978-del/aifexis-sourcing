"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { CancelInfo } from "@/events/cancel";
import { cancelEventAction } from "../../app/events/[id]/actions";

export default function CancelPanel({ locale = "en", eventId, version, info }: { locale?: Locale; eventId: string; version: number; info: CancelInfo }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (info.cancelledAt) return <div className="card detail"><div className="row"><h3>{tx(locale, "Event cancelled")}</h3></div><div className="sub">{info.cancelledAt.slice(0, 10)}</div><div className="bidtext">{info.reason}</div></div>;
  if (!info.canCancel) return null;
  async function go() {
    setBusy(true); setErr(null);
    const r = await cancelEventAction(eventId, version, reason, approver).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    router.refresh();
  }
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
          <div className="actions"><button className="btn" type="button" disabled={busy || reason.trim().length < 10 || !approver} onClick={go}>{busy ? tx(locale, "Saving...") : tx(locale, "Cancel the event")}</button><button className="btn ghost" type="button" onClick={() => setOpen(false)}>{tx(locale, "Keep the event")}</button></div>
        </div>)}
    </div>
  );
}
