"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { lbl, type L } from "@/templates/types";
import { setDefaultAction } from "../../app/templates/actions";

type Tpl = { key: string; title: L; eventType: "RFI" | "RFQ" | "RFP"; enabled: boolean; missing: string[] };
type Row = { eventType: "RFI" | "RFQ" | "RFP"; category: string; templateKey: string };
const TYPES = ["RFI", "RFQ", "RFP"] as const;

export default function TemplateDefaults({ locale, library, defaults, categories, canEdit }: { locale: Locale; library: Tpl[]; defaults: Row[]; categories: { code: string; en: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState({ type: "RFQ" as (typeof TYPES)[number], category: "", key: "" });
  const usable = (t: (typeof TYPES)[number]) => library.filter((x) => x.eventType === t && x.enabled && x.missing.length === 0);
  const name = (k: string) => { const t = library.find((x) => x.key === k); return t ? lbl(t.title, locale) : k; };
  const catName = (c: string) => (c === "*" ? tx(locale, "Any category") : categories.find((x) => x.code === c)?.en ?? c);
  async function run(type: string, category: string | null, key: string | null) {
    setBusy(true); setMsg(null);
    const r = await setDefaultAction(type, category, key).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) { setMsg(tx(locale, r.error)); return; }
    router.refresh();
  }
  return (
    <div className="card detail">
      <h3>{tx(locale, "Default templates")}</h3>
      <p className="sub">{tx(locale, "The default is pre-selected when someone creates an event. Without your choice, the built-in General template is used. A default for a category wins over everything else; a default for any category applies when nothing more specific fits. Buyers can always pick a different template.")}</p>
      {msg && <div className="alert" role="alert">{msg}</div>}
      {TYPES.map((t) => {
        const cur = defaults.find((d) => d.eventType === t && d.category === "*");
        const rows = defaults.filter((d) => d.eventType === t && d.category !== "*");
        return (
          <div key={t} className="stack">
            <div className="row"><b>{t}</b>
              {canEdit ? <select aria-label={`${t} ${tx(locale, "Any category")}`} disabled={busy} value={cur?.templateKey ?? ""} onChange={(e) => run(t, null, e.target.value || null)}>
                <option value="">{tx(locale, "Built-in General template")}</option>
                {usable(t).map((x) => <option key={x.key} value={x.key}>{lbl(x.title, locale)}</option>)}</select>
                : <span>{cur ? name(cur.templateKey) : tx(locale, "Built-in General template")}</span>}
            </div>
            {rows.map((d) => <div key={d.category} className="sub">{catName(d.category)}: {name(d.templateKey)} {canEdit && <button type="button" className="linkbtn" disabled={busy} onClick={() => run(t, d.category, null)}>{tx(locale, "Remove")}</button>}</div>)}
          </div>
        );
      })}
      {canEdit && (
        <form className="additem" onSubmit={(e) => { e.preventDefault(); if (add.key) run(add.type, add.category || null, add.key); }}>
          <select value={add.type} onChange={(e) => setAdd({ type: e.target.value as typeof add.type, category: add.category, key: "" })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          <select value={add.category} onChange={(e) => setAdd({ ...add, category: e.target.value })} aria-label={tx(locale, "Category")}>
            <option value="">{tx(locale, "Any category")}</option>{categories.map((c) => <option key={c.code} value={c.code}>{c.en}</option>)}</select>
          <select value={add.key} onChange={(e) => setAdd({ ...add, key: e.target.value })} aria-label={tx(locale, "Template")}>
            <option value="">{tx(locale, "Choose a template")}</option>{usable(add.type).map((x) => <option key={x.key} value={x.key}>{lbl(x.title, locale)}</option>)}</select>
          <button className="btn" type="submit" disabled={busy || !add.key}>{tx(locale, "Set default")}</button>
        </form>
      )}
    </div>
  );
}
