"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { ReassignInfo } from "@/evaluation/reassign";
import { reassignEvaluatorAction } from "../../app/events/[id]/actions";

export default function ReassignPanel({ locale = "en", eventId, info }: { locale?: Locale; eventId: string; info: ReassignInfo }) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    const r = await reassignEvaluatorAction(eventId, from, to, reason).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setFrom(""); setTo(""); setReason(""); router.refresh();
  }
  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Technical evaluators")}</h3></div>
      {info.history.map((h, i) => <p className="sub" key={i}>{h.at.slice(0, 10)} · {h.from} → {h.to} · {h.reason}</p>)}
      {info.canReassign && (
        <div className="newform" style={{ margin: 0 }}>
          <p className="sub">{tx(locale, "Replace an evaluator who cannot continue. Their scores stay on record but no longer count. The new evaluator starts with a blank score sheet.")}</p>
          <label>{tx(locale, "Replace")}<select value={from} onChange={(e) => setFrom(e.target.value)}><option value="">{tx(locale, "Choose a person")}</option>{info.evaluators.map((e) => <option key={e.membershipId} value={e.membershipId}>{e.email} ({tx(locale, "{n} scores", { n: e.scored })})</option>)}</select></label>
          <label>{tx(locale, "With")}<select value={to} onChange={(e) => setTo(e.target.value)}><option value="">{tx(locale, "Choose a person")}</option>{info.candidates.map((e) => <option key={e.membershipId} value={e.membershipId}>{e.email}</option>)}</select></label>
          <label>{tx(locale, "Reason")}<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></label>
          {err && <div className="alert" role="alert">{tx(locale, err)}</div>}
          <div className="actions"><button className="btn" type="button" disabled={busy || !from || !to || reason.trim().length < 5} onClick={go}>{busy ? tx(locale, "Saving...") : tx(locale, "Replace evaluator")}</button></div>
        </div>)}
    </div>
  );
}
