"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Supplier } from "@/suppliers/service";
import type { SupplierImportRow } from "@/suppliers/master";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { createSupplierAction, importSuppliersAction, previewSuppliersAction } from "../../app/suppliers/actions";
import ImportFile from "./ImportFile";

export default function SupplierList({ initial, canAdd, locale = "en" }: { initial: Supplier[]; canAdd: boolean; locale?: Locale }) {
  const [rows, setRows] = useState<(Supplier & { pending?: boolean })[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", contactName: "", contactEmail: "" });
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "active" | "blocked">("all");

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const temp: Supplier & { pending: boolean } = { id: "tmp-" + Date.now(), name: f.name.trim(), contactName: f.contactName.trim(), contactEmail: f.contactEmail.trim().toLowerCase(), vendorCode: "", country: "", category: "", phone: "", taxNo: "", notes: "", status: "active", pending: true };
    const input = f;
    setRows((r) => [...r, temp].sort((a, b) => a.name.localeCompare(b.name))); // shown at once
    setF({ name: "", contactName: "", contactEmail: "" });
    createSupplierAction(input).then((res) => {
      if (res.ok) setRows((r) => r.map((x) => (x.id === temp.id ? res.supplier : x)));
      else { setRows((r) => r.filter((x) => x.id !== temp.id)); setF(input); setError(res.error); }
    }).catch(() => { setRows((r) => r.filter((x) => x.id !== temp.id)); setF(input); setError("That could not be saved. Try again."); });
  }

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) => (show === "all" || r.status === show) && (!n || [r.name, r.contactName, r.contactEmail, r.vendorCode, r.country, r.category].some((x) => x.toLowerCase().includes(n))));
  }, [rows, q, show]);

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
          <ImportFile<SupplierImportRow> locale={locale} label="Import suppliers from Excel or CSV" importText="Import {n} suppliers" templateHref="/api/templates/suppliers" preview={previewSuppliersAction}
            columns={[{ head: "Company", get: (r) => r.name }, { head: "Email", get: (r) => r.contactEmail }, { head: "Vendor code", get: (r) => r.vendorCode ?? "" }, { head: "Country", get: (r) => r.country ?? "" }]}
            run={async (rows) => { const r = await importSuppliersAction(rows); return r.ok ? { ok: true, message: r.added === 1 ? "1 supplier was added." : `${r.added} suppliers were added.`, notes: r.skipped.map((s) => `Row ${s.row}: ${s.reason}`) } : r; }} />
        </form>
      )}
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      <div className="card detail">
        <div className="row"><h3>{tx(locale, "Suppliers")}</h3><span className="sub">{shown.length}</span></div>
        <div className="actions" style={{ marginTop: 0 }}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx(locale, "Search suppliers")} aria-label={tx(locale, "Search suppliers")} />
          <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label={tx(locale, "Status")}>
            <option value="all">{tx(locale, "All")}</option><option value="active">{tx(locale, "Active")}</option><option value="blocked">{tx(locale, "Blocked")}</option>
          </select>
        </div>
        {shown.length === 0 ? <div className="sub">{rows.length === 0 ? tx(locale, "No suppliers yet.") : tx(locale, "No suppliers match.")}</div> : (
          <div className="tablewrap"><table className="items"><thead><tr><th>{tx(locale, "Company")}</th><th>{tx(locale, "Vendor code")}</th><th>{tx(locale, "Contact")}</th><th>{tx(locale, "Email")}</th><th>{tx(locale, "Status")}</th></tr></thead><tbody>
            {shown.map((r) => (
              <tr key={r.id} className={r.pending ? "saving" : ""}>
                <td>{r.pending ? r.name : <Link className="sublink" href={`/suppliers/${r.id}`}>{r.name}</Link>}{r.category && <div className="sub">{r.category}</div>}</td>
                <td dir="ltr">{r.vendorCode || "-"}</td><td>{r.contactName || "-"}</td><td>{r.contactEmail}</td>
                <td>{r.status === "blocked" ? <span className="pill">{tx(locale, "Blocked")}</span> : tx(locale, "Active")}</td>
              </tr>))}
          </tbody></table></div>
        )}
      </div>
    </>
  );
}
