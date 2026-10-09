"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { Route } from "@/events/routing";
import type { TenantMember } from "@/events/workflow";
import { removeRouteAction, saveRouteAction } from "../../app/approvers/actions";

const STEPS: { key: "publication" | "technical" | "award"; label: string }[] = [
  { key: "publication", label: "Publication approval" }, { key: "technical", label: "Technical approval" }, { key: "award", label: "Award approval" },
];

export default function ApproverRouting({ locale, routes, people, canEdit }: { locale: Locale; routes: Route[]; people: TenantMember[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true); setMsg(null);
    const r = await fn().catch(() => ({ ok: false, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) { setMsg(("error" in r && r.error) || "That is not allowed."); return; }
    router.refresh();
  }
  const opts = (blank: string) => [<option key="" value="">{blank}</option>, ...people.map((p) => <option key={p.membershipId} value={p.membershipId}>{p.email}</option>)];
  return (
    <div className="stack">
      <div className="card detail">
        <p className="sub">{tx(locale, "Name who approves each step. When an event is submitted, empty approval seats on its team are filled from here. Nobody already on the team is replaced, and a person who would break separation of duties is skipped for their deputy.")}</p>
        {msg && <div className="err" role="alert">{tx(locale, msg)}</div>}
      </div>
      {STEPS.map((st) => (
        <div className="card detail" key={st.key}>
          <h3>{tx(locale, st.label)}</h3>
          <ul className="team">
            {routes.filter((r) => r.step === st.key).map((r) => (
              <li key={r.id}>
                <span>{tx(locale, "Seat {n}", { n: r.slot })}: {r.ownerEmail}</span>
                <span className="sub">{r.deputyEmail ? tx(locale, "Deputy {0}", { "0": r.deputyEmail }) : tx(locale, "No deputy")}{r.awayFrom && r.awayTo ? " · " + tx(locale, "Away {0} to {1}", { "0": r.awayFrom, "1": r.awayTo }) : ""}</span>
                {canEdit && <button className="btn ghost" type="button" disabled={busy} onClick={() => run(() => removeRouteAction(r.id))}>{tx(locale, "Remove")}</button>}
              </li>
            ))}
            {!routes.some((r) => r.step === st.key) && <li className="sub">{tx(locale, "Nobody named. Seats are filled by hand on each event.")}</li>}
          </ul>
          {canEdit && (
            <form className="additem" action={(fd) => run(() => saveRouteAction({
              step: st.key, slot: Number(fd.get("slot")), ownerId: String(fd.get("owner")), deputyId: String(fd.get("deputy") ?? "") || null,
              awayFrom: String(fd.get("from") ?? "") || null, awayTo: String(fd.get("to") ?? "") || null }))}>
              <select name="slot" aria-label={tx(locale, "Seat")} defaultValue="1">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{tx(locale, "Seat {n}", { n })}</option>)}</select>
              <select name="owner" aria-label={tx(locale, "Approver")} required defaultValue="">{opts(tx(locale, "Approver"))}</select>
              <select name="deputy" aria-label={tx(locale, "Deputy")} defaultValue="">{opts(tx(locale, "No deputy"))}</select>
              <label className="sub">{tx(locale, "Away from")} <input type="date" name="from" /></label>
              <label className="sub">{tx(locale, "to")} <input type="date" name="to" /></label>
              <button className="btn" type="submit" disabled={busy}>{tx(locale, "Save seat")}</button>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}
