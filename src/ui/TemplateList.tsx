"use client";
import { useState } from "react";
import type { TemplateRow } from "@/events/service";
import { deleteTemplateAction } from "../../app/events/[id]/actions";

export default function TemplateList({ initial, canDelete }: { initial: TemplateRow[]; canDelete: boolean }) {
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  async function remove(id: string) {
    const keep = rows; setRows((r) => r.filter((t) => t.id !== id)); setError(null);   // gone from the screen at once
    const r = await deleteTemplateAction(id).catch(() => ({ ok: false, error: "That could not be removed." }));
    if (!r.ok) { setRows(keep); setError(r.error ?? "That is not allowed."); }
  }
  return (
    <div className="card detail" style={{ maxWidth: 720 }}>
      <h3>Event templates</h3>
      <div className="sub">Save any event as a template from its page. New events can start from a template with the lines already in place.</div>
      {error && <div className="alert" role="alert">{error}</div>}
      {rows.length === 0 ? <div className="sub">No templates yet.</div> : rows.map((t) => (
        <div className="row" key={t.id}><span><b>{t.name}</b> <span className="sub">{t.lineCount} lines{t.ownerDept ? `, ${t.ownerDept}` : ""}</span></span>
          {canDelete && <button type="button" className="btn ghost" onClick={() => remove(t.id)}>Delete</button>}</div>
      ))}
    </div>
  );
}
