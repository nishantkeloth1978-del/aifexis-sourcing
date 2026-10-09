"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { RoundInfo } from "@/events/rounds";
import { startFinalRoundAction } from "../../app/approvers/actions";

export default function FinalRoundPanel({ locale, eventId, version, info }: { locale: Locale; eventId: string; version: number; info: RoundInfo }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<Record<string, boolean>>(Object.fromEntries(info.candidates.filter((c) => c.qualified).map((c) => [c.supplierId, true])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = (id: string) => info.candidates.find((c) => c.supplierId === id)?.name ?? id.slice(0, 8);
  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Final round")}</h3><span className="sub">{tx(locale, "Round {n}", { n: info.roundNo })}</span></div>
      {info.rounds.map((r) => (
        <p className="sub" key={r.roundNo}>{tx(locale, "Round {n}", { n: r.roundNo })} · {tx(locale, "{0} bidders invited", { "0": r.shortlist.length })} · {r.closesAt.slice(0, 16).replace("T", " ")} UTC · {r.reason}</p>
      ))}
      {info.canStart && !open && <button className="btn" type="button" onClick={() => setOpen(true)}>{tx(locale, "Start a final round")}</button>}
      {info.canStart && open && (
        <form className="stack" action={async (fd) => {
          setBusy(true); setErr(null);
          const r = await startFinalRoundAction(eventId, version, {
            shortlist: Object.keys(pick).filter((k) => pick[k]), closesAt: new Date(String(fd.get("closes"))).toISOString(), reason: String(fd.get("reason") ?? ""), approverId: String(fd.get("approver") ?? "") }).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
          setBusy(false);
          if (!r.ok) { setErr(r.error); return; }
          router.refresh();
        }}>
          <p className="sub">{tx(locale, "Only the bidders you choose can revise their bids. Earlier revisions are kept. The envelopes are sealed again and evaluation restarts after this round closes.")}</p>
          <ul className="team">
            {info.candidates.map((c) => (
              <li key={c.supplierId}><label><input type="checkbox" checked={!!pick[c.supplierId]} onChange={(e) => setPick((p) => ({ ...p, [c.supplierId]: e.target.checked }))} /> {name(c.supplierId)}</label>
                <span className="sub">{c.qualified ? tx(locale, "Qualified") : tx(locale, "Not qualified")}</span></li>
            ))}
          </ul>
          <label>{tx(locale, "New closing time")} <input type="datetime-local" name="closes" required /></label>
          <label>{tx(locale, "Reason")} <input name="reason" required minLength={5} maxLength={1000} /></label>
          <label>{tx(locale, "Award approver who agrees")} <select name="approver" required defaultValue="">
            <option value="" disabled>{tx(locale, "Choose a person")}</option>
            {info.approvers.map((a) => <option key={a.membershipId} value={a.membershipId}>{a.email}</option>)}</select></label>
          {err && <div className="err" role="alert">{tx(locale, err)}</div>}
          <div><button className="btn" type="submit" disabled={busy}>{tx(locale, "Open the final round")}</button> <button className="btn ghost" type="button" onClick={() => setOpen(false)}>{tx(locale, "Cancel")}</button></div>
        </form>
      )}
    </div>
  );
}
