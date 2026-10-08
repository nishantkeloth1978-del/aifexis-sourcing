"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { lab } from "./lab";
import type { Historic, Update } from "@/templates/lifecycle";
import { adoptAction, rollbackAction } from "../../app/templates/actions";

const KIND = { added: "Added", removed: "Removed", changed: "Changed" } as const;

/** New template versions waiting for review, and the history of the company's configurations with a way back. */
export default function TemplateLifecycle({ locale, updates, history, version, canEdit }: { locale: Locale; updates: Update[]; history: Historic[]; version: number; canEdit: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const key = useRef(crypto.randomUUID());
  const done = (text: string) => { key.current = crypto.randomUUID(); setMsg({ ok: true, text }); router.refresh(); };
  async function adopt(k: string) {
    const r = await adoptAction([k], key.current, version);
    if (!r.ok) setMsg({ ok: false, text: tx(locale, r.error) }); else done(tx(locale, "Updated. New events use the new version; existing events keep theirs."));
  }
  async function back(v: number) {
    const r = await rollbackAction(v, key.current, version);
    if (!r.ok) setMsg({ ok: false, text: tx(locale, r.error) + ("issues" in r && Array.isArray(r.issues) ? " " + (r.issues as { message: string }[]).map((i) => tx(locale, i.message)).join(" ") : "") }); else done(tx(locale, "Configuration restored as version {n}.", { n: r.version }));
  }
  if (updates.length === 0 && history.length < 2) return null;
  return (<>
    {msg && <div className={msg.ok ? "okbox" : "alert"} role="status">{msg.text}</div>}
    {updates.map((u) => (
      <div className="card" key={u.key}><div className="row"><h3>{tx(locale, "Update available")}: {lab(u.title, locale)}</h3><span className="sub">v{u.pinned} → v{u.latest}</span></div>
        {u.changes.length > 0 ? <ul>{u.changes.map((c) => <li key={c.collection + c.key}>{tx(locale, KIND[c.kind])}: {lab(c.label, locale)}</li>)}</ul> : <div className="sub">{tx(locale, "No visible changes to fields, questions or documents.")}</div>}
        <div className="sub">{tx(locale, "Events already created keep the template version they were created with.")}</div>
        {canEdit && <div className="actions"><button type="button" className="btn" onClick={() => adopt(u.key)}>{tx(locale, "Use the new version")}</button></div>}</div>
    ))}
    {history.length >= 2 && <div className="card"><div className="row"><h3>{tx(locale, "Configuration history")}</h3><button type="button" className="btn ghost" onClick={() => setOpen(!open)}>{open ? tx(locale, "Hide details") : tx(locale, "Details")}</button></div>
      {open && history.map((h) => (
        <div className="row" key={h.version}><span>{tx(locale, "Version {n}", { n: h.version })} · {new Date(h.createdAt).toLocaleDateString(locale === "ar" ? "ar-AE" : "en-GB")} {h.reason && <span className="sub">– {tx(locale, h.reason)}</span>}<br /><span className="sub">{h.templates.map((t) => `${t.key} v${t.version}`).join(", ")}</span></span>
          {h.status === "active" ? <b>{tx(locale, "Active")}</b> : canEdit && <button type="button" className="btn ghost" onClick={() => back(h.version)}>{tx(locale, "Restore")}</button>}</div>
      ))}</div>}
  </>);
}
