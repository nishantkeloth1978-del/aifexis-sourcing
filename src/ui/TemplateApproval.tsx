"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { lab } from "./lab";
import type { PendingTemplate } from "@/templates/approval";
import { decideTemplateAction, setApprovalRequiredAction } from "../../app/templates/actions";

/** Admin tool: require a second administrator to approve company template versions before they can be used. */
export default function TemplateApproval({ locale, required, pending }: { locale: Locale; required: boolean; pending: PendingTemplate[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  async function toggle(on: boolean) {
    setMsg(null); const r = await setApprovalRequiredAction(on);
    if (!r.ok) setMsg(r.error); else router.refresh();
  }
  async function decide(p: PendingTemplate, approve: boolean) {
    setMsg(null); const r = await decideTemplateAction(p.key, p.version, approve, note[p.key + p.version] ?? "");
    if (!r.ok) setMsg(r.error); else router.refresh();
  }
  return (
    <div className="card detail">
      <h3>{tx(locale, "Policy approval for company templates")}</h3>
      <label><input type="checkbox" checked={required} onChange={(e) => toggle(e.target.checked)} /> {tx(locale, "A second administrator must approve each new company template version before it can be used")}</label>
      {msg && <div className="err" role="alert">{tx(locale, msg)}</div>}
      {pending.length === 0 ? <p className="sub">{tx(locale, "Nothing is waiting for approval.")}</p> : pending.map((p) => {
        const k = p.key + p.version;
        return (
          <div key={k} className="card">
            <strong>{p.title}</strong> <span className="sub">{p.key} v{p.version}</span>
            {p.note && <p className="sub">{p.note}</p>}
            {p.first ? <p className="sub">{tx(locale, "First version of this template.")}</p>
              : p.changes.length === 0 ? <p className="sub">{tx(locale, "No visible differences in fields, questions or documents.")}</p>
              : <ul>{p.changes.map((c) => <li key={c.collection + c.key}>{c.kind === "added" ? tx(locale, "Added") : c.kind === "removed" ? tx(locale, "Removed") : tx(locale, "Changed")}: {lab(c.label, locale)} <span className="sub">({c.collection})</span></li>)}</ul>}
            {p.submittedByMe ? <p className="sub">{tx(locale, "You submitted this version. Another administrator must decide.")}</p> : <>
              <input aria-label={tx(locale, "Reason (required to reject)")} placeholder={tx(locale, "Reason (required to reject)")} value={note[k] ?? ""} onChange={(e) => setNote((n) => ({ ...n, [k]: e.target.value }))} />
              <div className="actions"><button className="btn" type="button" onClick={() => decide(p, true)}>{tx(locale, "Approve")}</button> <button className="btn ghost" type="button" onClick={() => decide(p, false)}>{tx(locale, "Reject")}</button></div></>}
          </div>
        );
      })}
    </div>
  );
}
