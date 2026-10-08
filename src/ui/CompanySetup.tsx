"use client";
import Link from "next/link";
import { useState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { lab } from "./lab";
import { CURRENCIES } from "@/templates/consts";
import type { Category, Industry, Policy, Profile } from "@/templates/service";
import { saveProfileAction, setPolicyAction } from "../../app/templates/actions";

const STATE: Record<Profile["status"], string> = { not_started: "Not started", in_progress: "In progress", gaps: "Configured with gaps", ready: "Ready" };

export default function CompanySetup({ locale, profile, industries, categories, policies, gaps, canEdit }: { locale: Locale; profile: Profile; industries: Industry[]; categories: Category[]; policies: Policy[]; gaps: string[]; canEdit: boolean }) {
  const [p, setP] = useState(profile);
  const [version, setVersion] = useState(profile.version);
  const [openGaps, setGaps] = useState(gaps);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pols, setPols] = useState(policies);
  const [np, setNp] = useState({ key: "", kind: "require_document", target: "", note: "" });
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  const toggle = (k: "categories" | "additionalIndustries", code: string) => set(k, p[k].includes(code) ? p[k].filter((c) => c !== code) : [...p[k], code]);
  const listIn = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const ind = industries.find((i) => i.code === p.primaryIndustry);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const r = await saveProfileAction({ primaryIndustry: p.primaryIndustry, additionalIndustries: p.additionalIndustries, subsector: p.subsector, categories: p.categories, country: p.country, locations: p.locations, currency: p.currency, defaultLanguage: p.defaultLanguage, languages: p.languages, timeZone: p.timeZone, departments: p.departments }, version);
    if (!r.ok) { setMsg({ ok: false, text: tx(locale, r.error) }); return; }
    setP(r.profile); setVersion(r.profile.version); setGaps(r.gaps); setMsg({ ok: true, text: tx(locale, "Saved.") });
  }
  async function savePolicy(pol: { key: string; kind: Policy["kind"]; target: string; confirmed: boolean; note: string }) {
    setMsg(null);
    const r = await setPolicyAction(pol);
    if (!r.ok) { setMsg({ ok: false, text: tx(locale, r.error) }); return; }
    setPols((x) => [...x.filter((y) => y.key !== pol.key), pol].sort((a, b) => a.key.localeCompare(b.key)));
    setMsg({ ok: true, text: tx(locale, "Saved.") });
  }
  const dis = !canEdit;
  return (
    <div className="setup">
      <div className="card"><div className="row"><h3>{tx(locale, "Setup status")}</h3><b>{tx(locale, STATE[p.status])}</b></div>
        {openGaps.length > 0 ? <ul className="errlist">{openGaps.map((g) => <li key={g}>{tx(locale, g)}</li>)}</ul> : <div className="okbox">{tx(locale, "Nothing is missing.")}</div>}
        {!canEdit && <div className="sub">{tx(locale, "Only an administrator can change the company setup.")}</div>}
        <div className="actions"><Link className="btn" href="/templates">{tx(locale, "Choose templates")}</Link></div>
      </div>
      {msg && <div className={msg.ok ? "okbox" : "alert"} role="status">{msg.text}</div>}
      <form onSubmit={save} className="card detail">
        <h3>{tx(locale, "1. Your industry")}</h3>
        <label>{tx(locale, "Primary industry")}
          <select value={p.primaryIndustry ?? ""} disabled={dis} onChange={(e) => set("primaryIndustry", e.target.value || null)}>
            <option value="">{tx(locale, "Choose…")}</option>
            {industries.map((i) => <option key={i.code} value={i.code}>{lab(i, locale)}{i.availability === "general" ? " *" : ""}</option>)}
          </select></label>
        {ind?.availability === "general" && <div className="sub">{tx(locale, "A dedicated template pack for this industry is not available yet. The general templates are used until it is.")}</div>}
        <label>{tx(locale, "Subsector (optional)")}<input value={p.subsector} disabled={dis} maxLength={120} onChange={(e) => set("subsector", e.target.value)} /></label>
        <details><summary>{tx(locale, "Additional industries")} ({p.additionalIndustries.length})</summary>
          <div className="checks">{industries.filter((i) => i.code !== p.primaryIndustry).map((i) => <label key={i.code}><input type="checkbox" disabled={dis} checked={p.additionalIndustries.includes(i.code)} onChange={() => toggle("additionalIndustries", i.code)} /> {lab(i, locale)}</label>)}</div></details>
        <h3>{tx(locale, "2. What you buy")}</h3>
        <div className="checks">{categories.map((c) => <label key={c.code}><input type="checkbox" disabled={dis} checked={p.categories.includes(c.code)} onChange={() => toggle("categories", c.code)} /> {lab(c, locale)}</label>)}</div>
        <h3>{tx(locale, "3. Where and how you operate")}</h3>
        <label>{tx(locale, "Country (two-letter code)")}<input value={p.country} disabled={dis} maxLength={2} onChange={(e) => set("country", e.target.value.toUpperCase())} /></label>
        <label>{tx(locale, "Operating locations (comma separated)")}<input value={p.locations.join(", ")} disabled={dis} onChange={(e) => set("locations", listIn(e.target.value))} /></label>
        <label>{tx(locale, "Base currency")}<select value={p.currency} disabled={dis} onChange={(e) => set("currency", e.target.value)}><option value="">{tx(locale, "Choose…")}</option>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>{tx(locale, "Default language")}<select value={p.defaultLanguage} disabled={dis} onChange={(e) => set("defaultLanguage", e.target.value as "en" | "ar")}><option value="en">English</option><option value="ar">العربية</option></select></label>
        <label>{tx(locale, "Time zone (for example Asia/Dubai)")}<input value={p.timeZone} disabled={dis} onChange={(e) => set("timeZone", e.target.value)} /></label>
        <label>{tx(locale, "Departments (comma separated)")}<input value={p.departments.join(", ")} disabled={dis} onChange={(e) => set("departments", listIn(e.target.value))} /></label>
        {canEdit && <div className="actions"><button className="btn" type="submit">{tx(locale, "Save setup")}</button></div>}
      </form>
      <div className="card detail">
        <h3>{tx(locale, "4. Company policies")}</h3>
        <p className="sub">{tx(locale, "A confirmed policy makes an item mandatory in every template that has it. Templates cannot weaken it.")}</p>
        {pols.length === 0 && <div className="sub">{tx(locale, "No policies yet.")}</div>}
        {pols.map((x) => (
          <div className="row" key={x.key}><span><b>{x.key}</b> <span className="sub">{tx(locale, x.kind === "require_document" ? "Required document" : x.kind === "require_question" ? "Required question" : x.kind === "require_field" ? "Required field" : "Note")}: {x.target}{x.note ? ` – ${x.note}` : ""}</span></span>
            <span>{x.confirmed ? <span className="okbox">{tx(locale, "Confirmed")}</span> : <span className="lotwarn">{tx(locale, "Not confirmed")}</span>} {canEdit && <button type="button" className="btn ghost" onClick={() => savePolicy({ ...x, confirmed: !x.confirmed })}>{x.confirmed ? tx(locale, "Unconfirm") : tx(locale, "Confirm")}</button>}</span></div>
        ))}
        {canEdit && <div className="newform">
          <label>{tx(locale, "Policy name")}<input value={np.key} maxLength={80} onChange={(e) => setNp({ ...np, key: e.target.value })} /></label>
          <label>{tx(locale, "Type")}<select value={np.kind} onChange={(e) => setNp({ ...np, kind: e.target.value })}><option value="require_document">{tx(locale, "Required document")}</option><option value="require_question">{tx(locale, "Required question")}</option><option value="require_field">{tx(locale, "Required field")}</option><option value="note">{tx(locale, "Note")}</option></select></label>
          <label>{tx(locale, "Item key")}<input value={np.target} maxLength={80} onChange={(e) => setNp({ ...np, target: e.target.value })} /></label>
          <label>{tx(locale, "Note (optional)")}<input value={np.note} maxLength={500} onChange={(e) => setNp({ ...np, note: e.target.value })} /></label>
          <div className="actions"><button type="button" className="btn ghost" onClick={() => { void savePolicy({ key: np.key, kind: np.kind as Policy["kind"], target: np.target, confirmed: false, note: np.note }); setNp({ key: "", kind: "require_document", target: "", note: "" }); }}>{tx(locale, "Add policy")}</button></div>
        </div>}
      </div>
    </div>
  );
}
