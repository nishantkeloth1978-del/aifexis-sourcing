"use client";
import { ARABIC_ENABLED } from "@/i18n/flag";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { lab } from "./lab";
import type { DocumentReq, Field, Question } from "@/templates/types";
import type { OverrideRowInfo } from "@/templates/lifecycle";
import { addOverrideAction, applyConfigAction, removeOverrideAction } from "../../app/templates/actions";

type Col = "fields" | "questions" | "documents";
interface Eff { fields: Field[]; questions: Question[]; documents: DocumentReq[] }

export default function CustomiseTemplate({ locale, templateKey, version, effective, overrides, locked, configVersion, canEdit }: { locale: Locale; templateKey: string; version: number; effective: Eff; overrides: OverrideRowInfo[]; locked: string[]; configVersion: number; canEdit: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState<{ col: Col; key: string; en: string; ar: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<boolean>(false);
  const [cv, setCv] = useState(configVersion);
  const key = useRef(crypto.randomUUID());
  const [nq, setNq] = useState({ key: "", en: "", ar: "", required: true });

  async function run(p: Promise<{ ok: boolean; error?: string; issues?: unknown }>) {
    setMsg(null);
    const r = await p;
    if (!r.ok) { setMsg({ ok: false, text: tx(locale, r.error ?? "That could not be saved. Try again.") + (Array.isArray(r.issues) && r.issues[0] ? " " + tx(locale, (r.issues[0] as { remediation?: string }).remediation ?? "") : "") }); return false; }
    setPending(true); router.refresh(); return true;
  }
  const op = (col: Col, k: string, o: "update" | "remove", value?: Record<string, unknown>) => run(addOverrideAction({ templateKey, collection: col, objectKey: k, op: o, ...(value ? { value } : {}) }));
  async function apply() {
    const r = await applyConfigAction(key.current, cv);
    if (!r.ok) { setMsg({ ok: false, text: tx(locale, r.error) }); return; }
    key.current = crypto.randomUUID(); setCv(r.version); setPending(false);
    setMsg({ ok: true, text: tx(locale, "Applied. New events use this wording (configuration version {n}).", { n: r.version }) });
  }
  const isLocked = (col: Col, k: string) => locked.includes(`${col}:${k}`);
  const rows: { col: Col; o: Field | Question | DocumentReq }[] = [...effective.fields.map((o) => ({ col: "fields" as Col, o })), ...effective.questions.map((o) => ({ col: "questions" as Col, o })), ...effective.documents.map((o) => ({ col: "documents" as Col, o }))];
  const required = (o: { required?: boolean | string }) => o.required === true;
  const colName = (c: Col) => tx(locale, c === "fields" ? "Field" : c === "questions" ? "Question" : "Document");
  return (
    <div className="setup">
      <div className="card"><div className="row"><span className="sub">{templateKey} v{version}</span>
        <span><a className="btn ghost" href={`/api/templates/${templateKey}/export`}>{tx(locale, "Download as JSON")}</a> <Link className="btn ghost" href="/templates">{tx(locale, "Templates")}</Link></span></div>
        <div className="sub">{tx(locale, "Changes here apply to your company only and to new events after you apply them. Items locked by a company policy cannot be weakened.")}</div></div>
      {msg && <div className={msg.ok ? "okbox" : "alert"} role="status">{msg.text}</div>}
      <div className="card detail"><div className="tablewrap"><table className="items"><thead><tr><th>{tx(locale, "Type")}</th><th>{tx(locale, "Wording")}</th><th>{tx(locale, "Required")}</th><th /></tr></thead><tbody>
        {rows.map(({ col, o }) => { const lk = isLocked(col, o.key); const e = edit?.col === col && edit.key === o.key; return (
          <tr key={`${col}:${o.key}`}><td>{colName(col)}</td>
            <td>{e ? <span><input aria-label="English" value={edit.en} onChange={(ev) => setEdit({ ...edit, en: ev.target.value, ...(ARABIC_ENABLED || (edit.ar && edit.ar !== edit.en) ? {} : { ar: ev.target.value }) })} />{ARABIC_ENABLED && <input aria-label="العربية" dir="rtl" value={edit.ar} onChange={(ev) => setEdit({ ...edit, ar: ev.target.value })} />} <button type="button" className="btn" onClick={async () => { if (await op(col, o.key, "update", { label: { en: edit.en.trim(), ar: edit.ar.trim() } })) setEdit(null); }}>{tx(locale, "Save")}</button> <button type="button" className="btn ghost" onClick={() => setEdit(null)}>{tx(locale, "Cancel")}</button></span> : lab(o.label, locale)}</td>
            <td>{required(o as { required?: boolean }) ? tx(locale, "Yes") : typeof (o as { required?: unknown }).required === "string" ? tx(locale, "Conditional") : tx(locale, "No")}{lk && <span className="sub"> · {tx(locale, "Locked by policy")}</span>}</td>
            <td>{canEdit && !e && <span className="actions" style={{ margin: 0 }}>
              <button type="button" className="btn ghost" onClick={() => setEdit({ col, key: o.key, en: o.label.en, ar: o.label.ar })}>{tx(locale, "Edit wording")}</button>
              {!lk && <button type="button" className="btn ghost" onClick={() => op(col, o.key, "update", { required: !required(o as { required?: boolean }) })}>{required(o as { required?: boolean }) ? tx(locale, "Make optional") : tx(locale, "Make mandatory")}</button>}
              {!lk && <button type="button" className="btn ghost" onClick={() => op(col, o.key, "remove")}>{tx(locale, "Remove")}</button>}</span>}</td></tr>); })}
      </tbody></table></div></div>
      {canEdit && <div className="card detail"><h3>{tx(locale, "Add a question")}</h3>
        <label>{tx(locale, "Key (letters, digits, underscore)")}<input value={nq.key} maxLength={60} onChange={(e) => setNq({ ...nq, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} /></label>
        <label>English<input value={nq.en} onChange={(e) => setNq({ ...nq, en: e.target.value, ...(ARABIC_ENABLED ? {} : { ar: e.target.value }) })} /></label>
        {ARABIC_ENABLED && <label>العربية<input dir="rtl" value={nq.ar} onChange={(e) => setNq({ ...nq, ar: e.target.value })} /></label>}
        <label><input type="checkbox" checked={nq.required} onChange={(e) => setNq({ ...nq, required: e.target.checked })} /> {tx(locale, "Mandatory")}</label>
        <div className="actions"><button type="button" className="btn ghost" disabled={!nq.key || !nq.en.trim() || (ARABIC_ENABLED && !nq.ar.trim())} onClick={async () => { if (await run(addOverrideAction({ templateKey, collection: "questions", objectKey: nq.key, op: "add", value: { section: "technical", label: { en: nq.en.trim(), ar: nq.ar.trim() }, type: "text", use: "info", required: nq.required } }))) setNq({ key: "", en: "", ar: "", required: true }); }}>{tx(locale, "Add question")}</button></div></div>}
      <div className="card detail"><h3>{tx(locale, "Your customisations")}</h3>
        {overrides.length === 0 && <div className="sub">{tx(locale, "No customisations yet.")}</div>}
        {overrides.map((o) => <div className="row" key={o.id}><span>{o.op} · {o.collection}:{o.objectKey}{o.value && "label" in o.value ? ` – ${lab(o.value.label as { en: string; ar: string }, locale)}` : ""}</span>{canEdit && <button type="button" className="btn ghost" onClick={() => run(removeOverrideAction(o.id))}>{tx(locale, "Remove")}</button>}</div>)}
        {canEdit && <div className="actions"><button type="button" className="btn" onClick={apply}>{tx(locale, "Apply to new events")}</button>{(pending || overrides.length > 0) && <span className="sub">{tx(locale, "Customisations take effect for new events once applied.")}</span>}</div>}
      </div>
    </div>
  );
}
