"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { dateLocale } from "@/i18n/dict";
import { REMINDER_CHOICES, type AutoAction, type LastRun, type Policy } from "@/automation/policy-types";
import { saveAutomationPolicyAction } from "../../app/configuration/actions";

/** What the system may do on its own: reminders, one capped extension, approver nudges, and a pause switch. */
export default function AutomationSettings({ locale, policy, recent, last }: { locale: Locale; policy: Policy; recent: AutoAction[]; last: LastRun | null }) {
  const router = useRouter();
  const [p, setP] = useState<Policy>(policy);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Policy>) => { setP((c) => ({ ...c, ...patch })); setState("idle"); setError(null); };
  const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const toggleDay = (d: number) => set({ reminderDays: p.reminderDays.includes(d) ? p.reminderDays.filter((x) => x !== d) : [...p.reminderDays, d].sort((a, b) => b - a) });
  async function save(e: React.FormEvent) {
    e.preventDefault(); setState("saving"); setError(null);
    const r = await saveAutomationPolicyAction(p).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    if (r.ok) { setState("saved"); router.refresh(); } else { setState("idle"); setError(r.error); }
  }
  const fmt = (iso: string) => new Date(iso).toLocaleString(dateLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const stale = !last || Date.now() - new Date(last.at).getTime() > 15 * 60_000;
  return (
    <form className="card newform detail" onSubmit={save} style={{ maxWidth: 760 }}>
      <div className="row"><h3>{tx(locale, "Automation")}</h3></div>
      <div className="sub">{tx(locale, "Choose what the system may do on its own. Every automatic step is recorded in the audit log, and a person still approves publication and award.")}</div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      {stale ? <div className="alert" role="alert">{tx(locale, last ? "The automatic run has not happened for over 15 minutes. Check that the worker or the scheduler is running." : "The automatic run has not happened yet. Start the worker or the scheduler.")}</div>
        : <div className="sub" role="status">{tx(locale, "Last automatic run")}: {fmt(last!.at)} ({tx(locale, last!.source === "worker" ? "worker" : "daily scheduler")})</div>}
      <label className="check" style={{ margin: "10px 0" }}><input type="checkbox" checked={p.paused} onChange={(e) => set({ paused: e.target.checked })} /> <b>{tx(locale, "Pause automation")}</b> {tx(locale, "(reminders, extensions and approver reminders stop; events still close at their closing time)")}</label>
      <fieldset style={{ border: 0, padding: 0, margin: "10px 0" }}>
        <legend><b>{tx(locale, "Remind suppliers who have not bid, this many days before closing")}</b></legend>
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>{REMINDER_CHOICES.map((d) => <label key={d} className="check"><input type="checkbox" checked={p.reminderDays.includes(d)} onChange={() => toggleDay(d)} /> {d}</label>)}</div>
      </fieldset>
      <label className="check" style={{ margin: "10px 0" }}><input type="checkbox" checked={p.extendEnabled} onChange={(e) => set({ extendEnabled: e.target.checked })} /> <b>{tx(locale, "Extend the deadline once when too few suppliers have bid")}</b></label>
      <div className="row" style={{ flexWrap: "wrap", gap: 16 }}>
        <label>{tx(locale, "Extend by (hours)")}<input type="number" min={1} max={168} value={Number.isNaN(p.extendHours) ? "" : p.extendHours} disabled={!p.extendEnabled} onChange={(e) => set({ extendHours: num(e.target.value) })} /></label>
        <label>{tx(locale, "Minimum bidding suppliers")}<input type="number" min={1} max={50} value={Number.isNaN(p.extendMinBids) ? "" : p.extendMinBids} disabled={!p.extendEnabled} onChange={(e) => set({ extendMinBids: num(e.target.value) })} /></label>
        <label>{tx(locale, "Remind approvers after (hours, 0 = never)")}<input type="number" min={0} max={336} value={Number.isNaN(p.nudgeHours) ? "" : p.nudgeHours} onChange={(e) => set({ nudgeHours: num(e.target.value) })} /></label>
      </div>
      <div className="row" style={{ marginTop: 12 }}><button className="btn" type="submit" disabled={state === "saving" || state === "saved"}>{state === "saving" ? tx(locale, "Saving...") : state === "saved" ? tx(locale, "Saved") : tx(locale, "Save automation settings")}</button></div>
      <h4 style={{ marginTop: 18 }}>{tx(locale, "Recent automatic actions")}</h4>
      {recent.length === 0 ? <div className="sub">{tx(locale, "Nothing has run automatically yet.")}</div> : (
        <ul className="sub" style={{ paddingLeft: 18 }}>{recent.map((a, i) => <li key={i}>{fmt(a.at)} · {a.ref} · {a.detail}</li>)}</ul>)}
    </form>
  );
}
