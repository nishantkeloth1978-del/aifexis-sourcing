"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Application, Registration } from "@/suppliers/registration";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { decideApplicationAction, setRegistrationAction } from "../../app/suppliers/actions";

export default function VendorApplications({ registration, applications, locale = "en" }: { registration: Registration | null; applications: Application[]; locale?: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reject, setReject] = useState<{ id: string; note: string } | null>(null);
  const run = async (f: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null); setBusy(true);
    const r = await f().catch(() => ({ ok: false, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) setError(r.error ?? "That could not be saved. Try again."); else { setReject(null); router.refresh(); }
  };
  const url = registration ? (registration.url.startsWith("/") ? `${typeof window === "undefined" ? "" : window.location.origin}${registration.url}` : registration.url) : "";
  const pending = applications.filter((a) => a.state === "pending");
  return (
    <div className="card detail" style={{ marginTop: 12 }}>
      <div className="row"><h3>{tx(locale, "Vendor registration")}</h3><span className="sub">{tx(locale, "{n} waiting for approval", { n: pending.length })}</span></div>
      <div className="sub">{tx(locale, "Share this link so new vendors can apply. You approve each application before the vendor can be invited.")}</div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      {registration?.enabled ? (
        <div className="linkbox">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <div className="actions">
            <button className="btn" type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); } }}>{copied ? tx(locale, "Copied") : tx(locale, "Copy link")}</button>
            <button className="btn ghost" type="button" disabled={busy} onClick={() => run(() => setRegistrationAction(true, true))}>{tx(locale, "Make a new link")}</button>
            <button className="btn ghost" type="button" disabled={busy} onClick={() => run(() => setRegistrationAction(false))}>{tx(locale, "Switch off")}</button>
          </div>
        </div>
      ) : <div className="actions"><button className="btn" type="button" disabled={busy} onClick={() => run(() => setRegistrationAction(true))}>{tx(locale, "Switch on vendor registration")}</button></div>}
      {applications.length > 0 && (
        <div className="tablewrap"><table className="items"><thead><tr><th>{tx(locale, "Company")}</th><th>{tx(locale, "Contact")}</th><th>{tx(locale, "Category")}</th><th>{tx(locale, "Country")}</th><th>{tx(locale, "Status")}</th><th /></tr></thead>
          <tbody>{applications.map((a) => (
            <tr key={a.id}>
              <td><b>{a.company}</b><div className="sub">{a.taxNo}</div></td>
              <td>{a.contactName}<div className="sub">{a.contactEmail}{a.phone ? ` · ${a.phone}` : ""}</div></td>
              <td>{a.category}</td><td>{a.country}</td>
              <td>{a.state === "pending" ? tx(locale, "Waiting") : a.state === "approved" ? tx(locale, "Approved") : `${tx(locale, "Rejected")}${a.decisionNote ? `: ${a.decisionNote}` : ""}`}</td>
              <td>{a.state === "pending" && (reject?.id === a.id ? (
                <span className="actions" style={{ margin: 0 }}><input aria-label={tx(locale, "Reason")} placeholder={tx(locale, "Reason")} value={reject.note} onChange={(e) => setReject({ id: a.id, note: e.target.value })} /><button className="btn ghost" type="button" disabled={busy} onClick={() => run(() => decideApplicationAction(a.id, false, reject.note))}>{tx(locale, "Reject")}</button></span>
              ) : (
                <span className="actions" style={{ margin: 0 }}><button className="btn" type="button" disabled={busy} onClick={() => run(() => decideApplicationAction(a.id, true))}>{tx(locale, "Approve")}</button><button className="btn ghost" type="button" disabled={busy} onClick={() => setReject({ id: a.id, note: "" })}>{tx(locale, "Reject")}</button></span>
              ))}</td>
            </tr>))}</tbody></table></div>
      )}
    </div>
  );
}
