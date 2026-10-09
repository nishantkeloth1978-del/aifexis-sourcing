"use client";
import { useState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { Simulation } from "@/events/routing";
import { simulateAction } from "../../app/approvers/actions";

const NAME: Record<string, string> = { publication: "Publication approval", technical: "Technical approval", award: "Award approval" };

export default function ApprovalSimulator({ locale }: { locale: Locale }) {
  const [sim, setSim] = useState<Simulation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  async function run(fd: FormData) {
    setErr(null);
    const raw = String(fd.get("value") ?? "").trim();
    const r = await simulateAction(raw === "" ? null : Number(raw), String(fd.get("date") || today));
    if (!r.ok) { setErr(r.error); setSim(null); return; }
    setSim(r.simulation);
  }
  return (
    <div className="card detail">
      <h3>{tx(locale, "Approval simulation")}</h3>
      <p className="sub">{tx(locale, "Try an event value and a date to see who would be asked to approve. Nothing is changed.")}</p>
      <form className="additem" action={run}>
        <label>{tx(locale, "Event value (AED)")} <input name="value" inputMode="decimal" /></label>
        <label>{tx(locale, "On date")} <input name="date" type="date" defaultValue={today} /></label>
        <button className="btn" type="submit">{tx(locale, "Simulate")}</button>
      </form>
      {err && <div className="err" role="alert">{tx(locale, err)}</div>}
      {sim && <div role="status">
        <p>{sim.autoPublish ? tx(locale, "Publication needs no approval at this value.") : tx(locale, "Publication needs approval at this value.")} {tx(locale, "Award approvals required: {n}", { n: sim.awardApprovals })}</p>
        <ul className="team">{sim.steps.map((s) => (
          <li key={s.step}><span>{tx(locale, NAME[s.step]!)} ({s.needed})</span>
            <span className="sub">{s.seated.length ? s.seated.map((p) => p.email + (p.via === "deputy" ? " " + tx(locale, "(deputy, owner is away)") : "")).join(", ") : "—"}</span></li>
        ))}</ul>
        {sim.warnings.length === 0 ? <div className="okbox">{tx(locale, "No routing problems found.")}</div>
          : <ul className="alert">{sim.warnings.map((w, i) => <li key={i}>{w.code === "none" ? tx(locale, "No approver is set for {step}.", { step: tx(locale, NAME[w.step]!) })
            : w.code === "short" ? tx(locale, "{step} needs {needed} approvers but only {have} are set.", { step: tx(locale, NAME[w.step]!), needed: w.needed ?? 0, have: w.have ?? 0 })
            : tx(locale, "{email} would approve both {a} and {b}.", { email: w.email ?? "", a: tx(locale, NAME[w.other!]!), b: tx(locale, NAME[w.step]!) })}</li>)}</ul>}
      </div>}
    </div>
  );
}
