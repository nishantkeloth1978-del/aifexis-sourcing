"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { lab } from "./lab";
import { CAPABILITY_LABEL } from "@/templates/types";
import type { L } from "@/templates/types";
import type { Reason, TemplateInfo } from "@/templates/service";
import { activateAction, previewSelectionAction } from "../../app/templates/actions";

type Row = Omit<TemplateInfo, "reasons"> & { reasons: Reason[] };
type Names = Record<string, L>;
const why = (r: Reason, locale: Locale, ind: Names, cat: Names) =>
  r.code === "pack_for_industry" ? tx(locale, "Pack for your industry: {0}", { 0: ind[r.industry] ? lab(ind[r.industry]!, locale) : r.industry })
  : r.code === "category_match" ? tx(locale, "Matches your category: {0}", { 0: cat[r.category] ? lab(cat[r.category]!, locale) : r.category })
  : r.code === "general" ? tx(locale, "General template, works for any purchase") : tx(locale, "Enabled by an administrator");

export default function TemplateLibrary({ locale, library, version, fallback, fallbackIndustry, industries, categories, canEdit }: { locale: Locale; library: Row[]; version: number; fallback: boolean; fallbackIndustry: string | null; industries: Names; categories: Names; canEdit: boolean }) {
  const [sel, setSel] = useState<string[]>(library.filter((t) => t.enabled).map((t) => t.key));
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "recommended" | "enabled">("all");
  const [ver, setVer] = useState(version);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; issues?: string[] } | null>(null);
  const [prev, setPrev] = useState<{ add: string[]; remove: string[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const key = useRef(crypto.randomUUID());
  const title = (k: string) => { const t = library.find((x) => x.key === k); return t ? lab(t.title, locale) : k; };

  const shown = useMemo(() => library.filter((t) => {
    if (filter === "recommended" && !t.reasons.length) return false;
    if (filter === "enabled" && !sel.includes(t.key)) return false;
    const hay = `${t.title.en} ${t.title.ar} ${t.summary.en} ${t.eventType} ${t.packLabel?.en ?? ""}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  }), [library, q, filter, sel]);

  async function toggle(k: string) {
    const next = sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k];
    setSel(next); setMsg(null); key.current = crypto.randomUUID();
    const p = await previewSelectionAction(next); setPrev({ add: p.add, remove: p.remove });
  }
  async function apply() {
    setMsg(null);
    const r = await activateAction(sel, key.current, ver);
    if (!r.ok) { setMsg({ ok: false, text: tx(locale, r.error), issues: "issues" in r && Array.isArray(r.issues) ? (r.issues as { message: string; remediation?: string; where?: string }[]).map((i) => `${i.where ? i.where + ": " : ""}${tx(locale, i.message)}${i.remediation ? " " + tx(locale, i.remediation) : ""}`) : undefined }); return; }
    setVer(r.version); setPrev(null); key.current = crypto.randomUUID();
    setMsg({ ok: true, text: tx(locale, "Templates saved. New events use this configuration (version {n}).", { n: r.version }) });
  }
  return (
    <div className="setup">
      {fallback && <div className="card"><div className="sub">{tx(locale, "No dedicated template pack exists for your industry yet, so the general templates are recommended.")}{fallbackIndustry && industries[fallbackIndustry] ? ` (${lab(industries[fallbackIndustry]!, locale)})` : ""}</div></div>}
      <div className="card"><div className="row">
        <input aria-label={tx(locale, "Search templates")} placeholder={tx(locale, "Search templates")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={tx(locale, "Show")}>
          <option value="all">{tx(locale, "All templates")}</option><option value="recommended">{tx(locale, "Recommended")}</option><option value="enabled">{tx(locale, "Enabled")}</option></select>
        <Link className="btn ghost" href="/setup">{tx(locale, "Company setup")}</Link></div></div>
      {msg && <div className={msg.ok ? "okbox" : "alert"} role="status">{msg.text}{msg.issues && <ul className="errlist">{msg.issues.map((m, i) => <li key={i}>{m}</li>)}</ul>}</div>}
      {shown.map((t) => (
        <div className="card" key={t.key}>
          <div className="row"><h3>{lab(t.title, locale)}</h3><span className="sub">{t.eventType} · {t.packLabel ? lab(t.packLabel, locale) : tx(locale, "General")} · v{t.version}</span></div>
          <div>{lab(t.summary, locale)}</div>
          {t.reasons.length > 0 && <div className="sub">{t.reasons.map((r) => why(r, locale, industries, categories)).join(" · ")}</div>}
          {t.missing.length > 0 && <div className="alert">{tx(locale, "This template needs {0}, which this application does not support yet.", { 0: t.missing.map((m) => CAPABILITY_LABEL[m] ?? m).map((m) => tx(locale, m)).join(", ") })}</div>}
          <div className="actions">
            <label><input type="checkbox" checked={sel.includes(t.key)} disabled={!canEdit || t.missing.length > 0} onChange={() => toggle(t.key)} /> {tx(locale, "Enabled for my company")}</label>
            {canEdit && sel.includes(t.key) && t.enabled && <Link className="btn ghost" href={`/templates/${t.key}`}>{tx(locale, "Customise")}</Link>}
            <button type="button" className="btn ghost" onClick={() => setOpen(open === t.key ? null : t.key)}>{open === t.key ? tx(locale, "Hide details") : tx(locale, "Details")}</button>
          </div>
          {open === t.key && <div className="sub">{tx(locale, "Category")}: {categories[t.categoryCode] ? lab(categories[t.categoryCode]!, locale) : t.categoryCode} · {tx(locale, "Pricing")}: {t.pricingModel} · {tx(locale, "Method")}: {t.method}</div>}
        </div>
      ))}
      {shown.length === 0 && <div className="card sub">{tx(locale, "No templates match.")}</div>}
      {canEdit && <div className="card">
        {prev && (prev.add.length > 0 || prev.remove.length > 0) && <div className="sub">{prev.add.length > 0 && <div>{tx(locale, "Will be enabled")}: {prev.add.map(title).join(", ")}</div>}{prev.remove.length > 0 && <div>{tx(locale, "Will be disabled")}: {prev.remove.map(title).join(", ")}</div>}<div>{tx(locale, "Events already created keep the template version they were created with.")}</div></div>}
        <div className="actions"><button className="btn" type="button" onClick={apply} disabled={sel.length === 0}>{tx(locale, "Save template selection")}</button></div>
      </div>}
      {!canEdit && <div className="sub">{tx(locale, "Only an administrator can activate the template library.")}</div>}
    </div>
  );
}
