"use client";
import Link from "next/link";
import { useState } from "react";
import type { SupplierProfile } from "@/suppliers/master";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { setSupplierStatusAction, updateSupplierAction } from "../../app/suppliers/actions";

export default function SupplierProfileForm({ data, canEdit, locale = "en" }: { data: SupplierProfile; canEdit: boolean; locale?: Locale }) {
  const [s, setS] = useState(data.supplier);
  const [f, setF] = useState({ name: s.name, contactName: s.contactName, vendorCode: s.vendorCode, country: s.country, category: s.category, phone: s.phone, taxNo: s.taxNo, notes: s.notes });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setSaved(false); setF({ ...f, [k]: e.target.value }); };

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    const r = await updateSupplierAction(s.id, f).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setS(r.supplier); setSaved(true);
  }
  async function toggle() {
    setError(null); setBusy(true);
    const next = s.status === "blocked" ? "active" : "blocked";
    const r = await setSupplierStatusAction(s.id, next).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setS({ ...s, status: next });
  }
  return (
    <>
      <form className="card newform" onSubmit={save}>
        <div className="row"><h3>{tx(locale, "Profile")}</h3>{s.status === "blocked" && <span className="pill">{tx(locale, "Blocked")}</span>}</div>
        <div className="two">
          <label>{tx(locale, "Company name")}<input value={f.name} onChange={set("name")} required maxLength={200} disabled={!canEdit} /></label>
          <label>{tx(locale, "Vendor code")}<input value={f.vendorCode} onChange={set("vendorCode")} maxLength={40} disabled={!canEdit} dir="ltr" /></label>
        </div>
        <div className="two">
          <label>{tx(locale, "Contact name")}<input value={f.contactName} onChange={set("contactName")} maxLength={100} disabled={!canEdit} /></label>
          <label>{tx(locale, "Contact email")}<input value={s.contactEmail} disabled dir="ltr" /></label>
        </div>
        <div className="two">
          <label>{tx(locale, "Country")}<input value={f.country} onChange={set("country")} maxLength={80} disabled={!canEdit} /></label>
          <label>{tx(locale, "Category")}<input value={f.category} onChange={set("category")} maxLength={120} disabled={!canEdit} /></label>
        </div>
        <div className="two">
          <label>{tx(locale, "Phone")}<input value={f.phone} onChange={set("phone")} maxLength={40} disabled={!canEdit} dir="ltr" /></label>
          <label>{tx(locale, "Tax number")}<input value={f.taxNo} onChange={set("taxNo")} maxLength={60} disabled={!canEdit} dir="ltr" /></label>
        </div>
        <label>{tx(locale, "Internal notes")}<textarea value={f.notes} onChange={set("notes")} maxLength={1000} rows={3} disabled={!canEdit} /></label>
        {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
        {saved && <div className="okbox">{tx(locale, "Saved.")}</div>}
        {canEdit && (
          <div className="actions">
            <button className="btn" type="submit" disabled={busy}>{tx(locale, "Save")}</button>
            <button className="btn ghost" type="button" disabled={busy} onClick={toggle}>{s.status === "blocked" ? tx(locale, "Unblock supplier") : tx(locale, "Block supplier")}</button>
          </div>)}
        {canEdit && s.status !== "blocked" && <div className="sub">{tx(locale, "Blocking stops new invitations. Existing invitations and past bids are not affected.")}</div>}
      </form>
      <div className="card detail">
        <div className="row"><h3>{tx(locale, "Event history")}</h3><span className="sub">{tx(locale, "{bids} bids, {wins} won", { bids: data.bids, wins: data.wins })}</span></div>
        {data.history.length === 0 ? <div className="sub">{tx(locale, "Not invited to any event yet.")}</div> : (
          <div className="tablewrap"><table className="items"><thead><tr><th>{tx(locale, "Event")}</th><th>{tx(locale, "Bid")}</th><th>{tx(locale, "Outcome")}</th></tr></thead><tbody>
            {data.history.map((h) => (
              <tr key={h.eventId}><td><Link className="sublink" href={`/events/${h.eventId}`}>{h.ref}</Link><div className="sub">{h.title}</div></td>
                <td>{h.bid ? tx(locale, "Submitted") : tx(locale, "No bid")}</td>
                <td>{h.outcome === "won" ? tx(locale, "Won") : h.outcome === "lost" ? tx(locale, "Not awarded") : "-"}</td></tr>))}
          </tbody></table></div>)}
      </div>
    </>
  );
}
