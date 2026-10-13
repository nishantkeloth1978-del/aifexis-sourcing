"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { TenantRow } from "@/platform/service";
import { createTenantAction, inviteTenantAdminAction, setSuspendedAction } from "../../app/platform/actions";

export default function PlatformConsole({ locale, tenants }: { locale: Locale; tenants: TenantRow[] }) {
  const router = useRouter();
  const [name, setName] = useState(""), [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<{ label: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const url = (t: string) => `${window.location.origin}/join/${t}`;
  async function go(fn: () => Promise<{ ok: boolean; error?: string; token?: string }>, label?: string) {
    setBusy(true); setErr(null); const r = await fn(); setBusy(false);
    if (!r.ok) setErr(r.error ?? "That could not be saved. Try again.");
    else { if (r.token) setLink({ label: label ?? "", url: url(r.token) }); router.refresh(); }
    return r.ok;
  }
  return (
    <>
      {err && <div className="alert" role="alert">{tx(locale, err)}</div>}
      {link && <div className="linkbox" role="status"><b>{link.label}</b><div><code>{link.url}</code></div>
        <button className="btn ghost" type="button" onClick={() => void navigator.clipboard?.writeText(link.url)}>{tx(locale, "Copy link")}</button>
        <div className="sub">{tx(locale, "Shown once. Send it to the administrator; it expires in 14 days.")}</div></div>}
      <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await go(() => createTenantAction(name, email), name)) { setName(""); setEmail(""); } }}>
        <h2>{tx(locale, "Create an organisation")}</h2>
        <label>{tx(locale, "Organisation name")}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required /></label>
        <label>{tx(locale, "First administrator e-mail")}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <button className="btn" disabled={busy}>{tx(locale, "Create and get join link")}</button>
      </form>
      <table className="tbl"><thead><tr><th>{tx(locale, "Organisation")}</th><th>{tx(locale, "People")}</th><th>{tx(locale, "Administrators")}</th><th>{tx(locale, "Events")}</th><th>{tx(locale, "Suppliers")}</th><th /></tr></thead>
        <tbody>{tenants.map((t) => (
          <tr key={t.id} className={t.suspended ? "off" : ""}>
            <td><b>{t.name}</b>{t.suspended && <span className="chip"> {tx(locale, "Suspended")}</span>}</td>
            <td>{t.members}</td><td>{t.admins}</td><td>{t.events}</td><td>{t.suppliers}</td>
            <td>
              <button className="btn ghost" type="button" disabled={busy} onClick={() => { const a = window.prompt(tx(locale, "Administrator e-mail")); if (a) void go(() => inviteTenantAdminAction(t.id, a), t.name); }}>{tx(locale, "Invite administrator")}</button>{" "}
              <button className="btn ghost" type="button" disabled={busy} onClick={() => go(() => setSuspendedAction(t.id, !t.suspended))}>{t.suspended ? tx(locale, "Reactivate") : tx(locale, "Suspend")}</button>
            </td>
          </tr>))}</tbody></table>
    </>
  );
}
