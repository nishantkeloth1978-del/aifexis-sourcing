"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { lab } from "./lab";
import type { Candidate, Category } from "@/templates/service";
import { createFromTemplateAction, matchAction } from "../../app/templates/actions";

export default function NewFromTemplate({ locale, categories, mine, configured }: { locale: Locale; categories: Category[]; mine: string[]; configured: boolean }) {
  const router = useRouter();
  const [category, setCategory] = useState(mine[0] ?? "GENERAL");
  const [eventType, setEventType] = useState<"RFI" | "RFQ" | "RFP">("RFQ");
  const [pricing, setPricing] = useState("");
  const [res, setRes] = useState<{ candidates: Candidate[]; ambiguous: boolean; fallback: boolean } | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [title, setTitle] = useState(""); const [dept, setDept] = useState(""); const [closes, setCloses] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const ordered = [...categories.filter((c) => mine.includes(c.code)), ...categories.filter((c) => !mine.includes(c.code))];

  if (!configured) return <div className="card"><div>{tx(locale, "Set up the company templates before creating an event from one.")}</div><div className="actions"><Link className="btn" href="/setup">{tx(locale, "Company setup")}</Link><Link className="btn ghost" href="/templates">{tx(locale, "Templates")}</Link></div></div>;

  async function find(e: React.FormEvent) {
    e.preventDefault(); setError(null); setPick(null);
    const r = await matchAction({ category, eventType, ...(pricing ? { pricingModel: pricing } : {}) });
    if (!r.ok) { setError(tx(locale, r.error)); return; }
    setRes(r.result); if (r.result.candidates.length && !r.result.ambiguous) setPick(r.result.candidates[0]!.template.key);
  }
  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!pick) return; setError(null); setBusy(true);
    const r = await createFromTemplateAction({ templateKey: pick, title, ownerDept: dept || undefined, closesAt: closes ? new Date(closes).toISOString() : undefined, idempotencyKey: key.current });
    setBusy(false);
    if (!r.ok) { setError(tx(locale, r.error)); return; }
    router.push(`/events/${r.event.id}`);
  }
  return (
    <div className="setup">
      {error && <div className="alert" role="alert">{error}</div>}
      <form onSubmit={find} className="card detail">
        <h3>{tx(locale, "1. What are you buying?")}</h3>
        <label>{tx(locale, "Category")}<select value={category} onChange={(e) => setCategory(e.target.value)}>{ordered.map((c) => <option key={c.code} value={c.code}>{lab(c, locale)}</option>)}</select></label>
        <label>{tx(locale, "Event type")}<select value={eventType} onChange={(e) => setEventType(e.target.value as typeof eventType)}><option value="RFI">{tx(locale, "RFI – request for information")}</option><option value="RFQ">{tx(locale, "RFQ – request for quotation")}</option><option value="RFP">{tx(locale, "RFP – request for proposal")}</option></select></label>
        <label>{tx(locale, "How will suppliers price it?")}<select value={pricing} onChange={(e) => setPricing(e.target.value)}>
          <option value="">{tx(locale, "Any")}</option><option value="itemized">{tx(locale, "Itemised quantities")}</option><option value="person_day">{tx(locale, "Person-days")}</option><option value="manpower">{tx(locale, "Manpower per month")}</option><option value="subscription">{tx(locale, "Subscription")}</option><option value="milestone">{tx(locale, "Milestones")}</option><option value="freight">{tx(locale, "Freight lanes")}</option></select></label>
        <div className="actions"><button className="btn" type="submit">{tx(locale, "Find templates")}</button></div>
      </form>
      {res && res.candidates.length === 0 && <div className="card"><div>{tx(locale, "None of the enabled templates fits. Enable more templates, or choose a different type or category.")}</div><div className="actions"><Link className="btn ghost" href="/templates">{tx(locale, "Templates")}</Link></div></div>}
      {res && res.candidates.length > 0 && (
        <form onSubmit={create} className="card detail">
          <h3>{tx(locale, "2. Choose a template")}</h3>
          {res.ambiguous && <div className="sub">{tx(locale, "More than one template fits equally well. Choose one.")}</div>}
          {res.fallback && <div className="sub">{tx(locale, "Only a general template fits. You can add your own questions and lines after creating the event.")}</div>}
          {res.candidates.map((c) => <label key={c.template.key} className="row"><span><input type="radio" name="tpl" checked={pick === c.template.key} onChange={() => setPick(c.template.key)} /> <b>{lab(c.template.title, locale)}</b> <span className="sub">v{c.template.version}{c.template.packLabel ? ` · ${lab(c.template.packLabel, locale)}` : ""}</span><br /><span className="sub">{lab(c.template.summary, locale)}</span></span></label>)}
          <h3>{tx(locale, "3. Event details")}</h3>
          <label>{tx(locale, "Title")}<input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} /></label>
          <label>{tx(locale, "Department")}<input value={dept} onChange={(e) => setDept(e.target.value)} maxLength={120} /></label>
          <label>{tx(locale, "Closing date and time")}<input type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} /></label>
          <div className="actions"><button className="btn" type="submit" disabled={busy || !pick || !title.trim()}>{tx(locale, "Create draft")}</button></div>
        </form>
      )}
    </div>
  );
}
