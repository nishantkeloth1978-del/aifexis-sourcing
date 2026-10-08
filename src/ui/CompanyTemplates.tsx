"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { lab } from "./lab";
import type { Category } from "@/templates/service";
import { cloneTemplateAction, importTemplateAction } from "../../app/templates/actions";

/** Admin tool: start a company template from a platform one, or import one from a JSON file. */
export default function CompanyTemplates({ locale, categories, library }: { locale: Locale; categories: Category[]; library: { key: string; title: { en: string; ar: string } }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"clone" | "import">("clone");
  const [from, setFrom] = useState(library[0]?.key ?? "");
  const [f, setF] = useState({ key: "", en: "", ar: "", category: "GENERAL", eventType: "RFQ" as "RFI" | "RFQ" | "RFP" });
  const [json, setJson] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; issues?: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const meta = { key: f.key, title: { en: f.en, ar: f.ar }, category: f.category, eventType: f.eventType };
    const r = await (mode === "clone" ? cloneTemplateAction(from, meta) : importTemplateAction(meta, json));
    if (!r.ok) { setMsg({ ok: false, text: tx(locale, r.error), issues: "issues" in r && Array.isArray(r.issues) ? (r.issues as { message: string }[]).map((i) => tx(locale, i.message)) : undefined }); return; }
    setMsg({ ok: true, text: tx(locale, "Saved as {0} (version {n}). Enable it in the list below.", { 0: r.key, n: r.version }) }); router.refresh();
  }
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const x = e.target.files?.[0]; e.target.value = ""; if (!x) return;
    if (x.size > 250_000) { setMsg({ ok: false, text: tx(locale, "The template is too large.") }); return; }
    setJson(await x.text());
  }
  return (
    <div className="card">
      <div className="row"><h3>{tx(locale, "Your own templates")}</h3><span><a className="btn ghost" href="/templates/editor">{tx(locale, "Open the visual editor")}</a> <button type="button" className="btn ghost" onClick={() => setOpen(!open)}>{open ? tx(locale, "Close") : tx(locale, "Create a template")}</button></span></div>
      {open && <form onSubmit={submit} className="detail">
        <label><input type="radio" checked={mode === "clone"} onChange={() => setMode("clone")} /> {tx(locale, "Copy an existing template")}</label>
        <label><input type="radio" checked={mode === "import"} onChange={() => setMode("import")} /> {tx(locale, "Import from a JSON file")}</label>
        {mode === "clone" ? <label>{tx(locale, "Copy from")}<select value={from} onChange={(e) => setFrom(e.target.value)}>{library.map((t) => <option key={t.key} value={t.key}>{lab(t.title, locale)}</option>)}</select></label>
          : <><input ref={file} type="file" accept=".json,application/json" hidden onChange={pick} /><div className="actions"><button type="button" className="btn ghost" onClick={() => file.current?.click()}>{tx(locale, "Choose a JSON file")}</button>{json && <span className="sub">{tx(locale, "{n} characters loaded", { n: json.length })}</span>}</div></>}
        <label>{tx(locale, "Template key")}<input value={f.key} maxLength={64} placeholder="CO_MY_TEMPLATE" onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} /></label>
        <label>{tx(locale, "Name (English)")}<input value={f.en} maxLength={160} onChange={(e) => setF({ ...f, en: e.target.value })} /></label>
        <label>{tx(locale, "Name (Arabic)")}<input dir="rtl" value={f.ar} maxLength={160} onChange={(e) => setF({ ...f, ar: e.target.value })} /></label>
        <label>{tx(locale, "Category")}<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{categories.map((c) => <option key={c.code} value={c.code}>{lab(c, locale)}</option>)}</select></label>
        <label>{tx(locale, "Event type")}<select value={f.eventType} onChange={(e) => setF({ ...f, eventType: e.target.value as typeof f.eventType })}><option>RFI</option><option>RFQ</option><option>RFP</option></select></label>
        <div className="actions"><button className="btn" type="submit" disabled={!f.key.startsWith("CO_") || !f.en.trim() || !f.ar.trim() || (mode === "import" && !json)}>{tx(locale, "Save template")}</button></div>
        {msg && <div className={msg.ok ? "okbox" : "alert"} role="status">{msg.text}{msg.issues && <ul className="errlist">{msg.issues.map((m, i) => <li key={i}>{m}</li>)}</ul>}</div>}
      </form>}
    </div>
  );
}
