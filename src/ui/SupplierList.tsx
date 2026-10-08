"use client";
import { useState } from "react";
import type { Supplier } from "@/suppliers/service";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { createSupplierAction } from "../../app/suppliers/actions";

export default function SupplierList({ initial, canAdd, locale = "en" }: { initial: Supplier[]; canAdd: boolean; locale?: Locale }) {
  const [rows, setRows] = useState<(Supplier & { pending?: boolean })[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", contactName: "", contactEmail: "" });

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const temp = { id: "tmp-" + Date.now(), name: f.name.trim(), contactName: f.contactName.trim(), contactEmail: f.contactEmail.trim().toLowerCase(), pending: true };
    const input = f;
    setRows((r) => [...r, temp].sort((a, b) => a.name.localeCompare(b.name))); // shown at once
    setF({ name: "", contactName: "", contactEmail: "" });
    createSupplierAction(input).then((res) => {
      if (res.ok) setRows((r) => r.map((x) => (x.id === temp.id ? res.supplier : x)));
      else { setRows((r) => r.filter((x) => x.id !== temp.id)); setF(input); setError(res.error); }
    }).catch(() => { setRows((r) => r.filter((x) => x.id !== temp.id)); setF(input); setError("That could not be saved. Try again."); });
  }

  return (
    <>
      {canAdd && (
        <form className="card newform" onSubmit={add}>
          <h3>{tx(locale, "Add a supplier")}</h3>
          <label>{tx(locale, "Company name")}<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={200} /></label>
          <div className="two">
            <label>{tx(locale, "Contact name")}<input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} maxLength={100} /></label>
            <label>{tx(locale, "Contact email")}<input type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} required /></label>
          </div>
          <div className="actions"><button className="btn" type="submit">{tx(locale, "Add supplier")}</button></div>
        </form>
      )}
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      <div className="card detail">
        <div className="row"><h3>{tx(locale, "Suppliers")}</h3><span className="sub">{rows.length}</span></div>
        {rows.length === 0 ? <div className="sub">{tx(locale, "No suppliers yet.")}</div> : (
          <div className="tablewrap"><table className="items"><thead><tr><th>{tx(locale, "Company")}</th><th>{tx(locale, "Contact")}</th><th>{tx(locale, "Email")}</th></tr></thead><tbody>
            {rows.map((r) => <tr key={r.id} className={r.pending ? "saving" : ""}><td>{r.name}</td><td>{r.contactName || "-"}</td><td>{r.contactEmail}</td></tr>)}
          </tbody></table></div>
        )}
      </div>
    </>
  );
}
