"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { AutopilotInfo } from "@/automation/autopilot-types";
import { takeOverEventAction } from "../../app/events/[id]/actions";

export default function AutopilotPanel({ locale = "en", eventId, info, people }: { locale?: Locale; eventId: string; info: AutopilotInfo; people: { membershipId: string; email: string }[] }) {
  const router = useRouter();
  const [sel, setSel] = useState({ buyer: "", witness: "", techApprover: "", awardApprover: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = (k: keyof typeof sel, label: string) => (
    <label>{tx(locale, label)}<select value={sel[k]} onChange={(e) => setSel({ ...sel, [k]: e.target.value })}><option value="">{tx(locale, "Choose a person")}</option>{people.map((p) => <option key={p.membershipId} value={p.membershipId}>{p.email}</option>)}</select></label>);
  async function go() {
    setBusy(true); setErr(null);
    const r = await takeOverEventAction(eventId, sel).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    router.refresh();
  }
  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Autopilot")}</h3></div>
      {info.hold ? <div className="alert" role="alert">{tx(locale, "Autopilot stopped: {reason}", { reason: info.hold })}</div>
        : <p className="sub">{tx(locale, "This event is run by Autopilot with no person approving. Every step is in the activity log under Autopilot.")}</p>}
      {info.canTakeOver && (
        <div className="newform" style={{ margin: 0 }}>
          <p className="sub">{tx(locale, "Take the event over: the people you choose replace Autopilot on this event and Autopilot never touches it again. The buyer cannot also be an approver.")}</p>
          {err && <div className="alert" role="alert">{tx(locale, err)}</div>}
          {pick("buyer", "Buyer")}{pick("witness", "Witness")}{pick("techApprover", "Publication and technical approver")}{pick("awardApprover", "Award approver")}
          <button className="btn" type="button" disabled={busy || Object.values(sel).some((x) => !x)} onClick={go}>{busy ? tx(locale, "Saving...") : tx(locale, "Take over from Autopilot")}</button>
        </div>)}
    </div>
  );
}
