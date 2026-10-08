"use client";
import { useMemo, useState } from "react";
import type { CatalogInput, CatalogItem } from "@/catalog/service";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { addCatalogAction, importCatalogAction, previewCatalogAction, updateCatalogAction } from "../../app/items/actions";
import ImportFile from "./ImportFile";

const EMPTY = { code: "", description: "", unit: "EA", category: "" };

export default function CatalogManager({ initial, canEdit, locale = "en" }: { initial: CatalogItem[]; canEdit: boolean; locale?: Locale }) {
  const [rows, setRows] = useState<CatalogItem[]>(initial);
  const [f, setF] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) => (showInactive || r.active) && (!n || [r.code, r.description, r.category].some((x) => x.toLowerCase().includes(n))));
  }, [rows, q, showInactive]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    const r = editing ? await updateCatalogAction(editing, f) : await addCatalogAction(f);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setRows((x) => (editing ? x.map((y) => (y.id === editing ? r.item : y)) : [...x, r.item]).sort((a, b) => a.code.localeCompare(b.code)));
    setF(EMPTY); setEditing(null);
  }
  async function toggle(it: CatalogItem) {
    setError(null);
    const r = await updateCatalogAction(it.id, { code: it.code, description: it.description, unit: it.unit, category: it.category, active: !it.active }).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    if (!r.ok) { setError(r.error); return; }
    setRows((x) => x.map((y) => (y.id === it.id ? r.item : y)));
  }
  const start = (it: CatalogItem) => { setEditing(it.id); setF({ code: it.code, description: it.description, unit: it.unit, category: it.category }); setError(null); };

  return (
    <>
      {canEdit && (
        <form className="card newform" onSubmit={save}>
          <h3>{editing ? tx(locale, "Edit item") : tx(locale, "Add an item")}</h3>
          <div className="two">
            <label>{tx(locale, "Item code")}<input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required maxLength={40} dir="ltr" /></label>
            <label>{tx(locale, "Unit")}<input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} required maxLength={20} /></label>
          </div>
          <label>{tx(locale, "Description")}<input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required maxLength={500} /></label>
          <label>{tx(locale, "Category")}<input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} maxLength={120} /></label>
          {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
          <div className="actions">
            <button className="btn" type="submit" disabled={busy}>{editing ? tx(locale, "Save") : tx(locale, "Add item")}</button>
            {editing && <button className="btn ghost" type="button" onClick={() => { setEditing(null); setF(EMPTY); }}>{tx(locale, "Cancel")}</button>}
          </div>
          <ImportFile<CatalogInput> locale={locale} label="Import items from Excel or CSV" importText="Import {n} items" templateHref="/api/templates/catalog" preview={previewCatalogAction}
            columns={[{ head: "Code", get: (r) => r.code }, { head: "Description", get: (r) => r.description }, { head: "Unit", get: (r) => r.unit }, { head: "Category", get: (r) => r.category ?? "" }]}
            run={async (rows) => { const r = await importCatalogAction(rows); return r.ok ? { ok: true, message: `${r.added} added, ${r.updated} updated.` } : r; }} />
        </form>
      )}
      {!canEdit && error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      <div className="card detail">
        <div className="row"><h3>{tx(locale, "Item catalogue")}</h3><span className="sub">{shown.length}</span></div>
        <div className="sub">{tx(locale, "Items in the catalogue can be picked by code when you add lines to an event, and the code is passed on in the award handover.")}</div>
        <div className="actions">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx(locale, "Search items")} aria-label={tx(locale, "Search items")} />
          <label className="inline"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> {tx(locale, "Show inactive")}</label>
        </div>
        {shown.length === 0 ? <div className="sub">{rows.length === 0 ? tx(locale, "No items yet.") : tx(locale, "No items match.")}</div> : (
          <div className="tablewrap"><table className="items"><thead><tr><th>{tx(locale, "Code")}</th><th>{tx(locale, "Description")}</th><th>{tx(locale, "Unit")}</th><th>{tx(locale, "Category")}</th>{canEdit && <th />}</tr></thead><tbody>
            {shown.map((r) => (
              <tr key={r.id} className={r.active ? "" : "saving"}><td dir="ltr">{r.code}</td><td>{r.description}</td><td>{r.unit}</td><td>{r.category || "-"}</td>
                {canEdit && <td className="num"><button className="btn ghost" type="button" onClick={() => start(r)}>{tx(locale, "Edit")}</button> <button className="btn ghost" type="button" onClick={() => toggle(r)}>{r.active ? tx(locale, "Deactivate") : tx(locale, "Activate")}</button></td>}</tr>))}
          </tbody></table></div>)}
      </div>
    </>
  );
}
