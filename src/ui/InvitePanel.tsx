"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InvitationRow, Supplier } from "@/suppliers/service";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { freshLinksAction, inviteAction } from "../../app/suppliers/actions";

export default function InvitePanel({ eventId, suppliers, invitations, locale = "en" }: { eventId: string; suppliers: Supplier[]; invitations: InvitationRow[]; locale?: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [all, setAll] = useState<{ supplier: string; email: string; url: string }[] | null>(null);
  const byId = new Map(invitations.map((i) => [i.supplierId, i]));

  async function invite(s: Supplier) {
    setError(null); setBusy(s.id); setCopied(false);
    const res = await inviteAction(eventId, s.id).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    setLink({ name: s.name, url: `${process.env.NEXT_PUBLIC_SUPPLIER_URL || window.location.origin}/invite/${res.token}` });
    router.refresh();
  }
  async function getAll() {
    setError(null); setBusy("all");
    const res = await freshLinksAction(eventId).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    setAll(res.links); router.refresh();
  }
  async function copyAll() {
    if (!all) return;
    try { await navigator.clipboard.writeText(all.map((l) => `${l.supplier}${l.email ? ` <${l.email}>` : ""}\n${l.url}`).join("\n\n")); setCopied(true); } catch { setCopied(false); }
  }
  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Suppliers")}</h3><span className="sub">{tx(locale, "{n} invited", { n: invitations.length })}</span></div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      {link && (
        <div className="linkbox">
          <div><b>{tx(locale, "Invitation link for {name}", { name: link.name })}</b> {tx(locale, "(shown once, valid 14 days). Send it to the supplier's contact.")}</div>
          <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
          <div className="actions"><button className="btn" type="button" onClick={copy}>{copied ? tx(locale, "Copied") : tx(locale, "Copy link")}</button><button className="btn ghost" type="button" onClick={() => setLink(null)}>{tx(locale, "Done")}</button></div>
        </div>
      )}
      {invitations.length > 0 && <div className="actions"><button className="btn ghost" type="button" disabled={busy !== null} onClick={getAll}>{busy === "all" ? tx(locale, "Creating...") : tx(locale, "Get invitation links for everyone not yet signed up")}</button></div>}
      {all && (
        <div className="linkbox">
          <div><b>{tx(locale, "New invitation links")}</b> {tx(locale, "(shown once, old links stop working). Send each to its supplier.")}</div>
          {all.length === 0 ? <div className="sub">{tx(locale, "Everyone has already signed up.")}</div> : <textarea readOnly rows={Math.min(12, all.length * 3)} value={all.map((l) => `${l.supplier}${l.email ? ` <${l.email}>` : ""}\n${l.url}`).join("\n\n")} onFocus={(e) => e.currentTarget.select()} />}
          <div className="actions">{all.length > 0 && <button className="btn" type="button" onClick={copyAll}>{copied ? tx(locale, "Copied") : tx(locale, "Copy all")}</button>}<button className="btn ghost" type="button" onClick={() => setAll(null)}>{tx(locale, "Done")}</button></div>
        </div>
      )}
      {suppliers.length === 0 ? <div className="sub">{tx(locale, "Add suppliers first on the Suppliers page.")}</div> : (
        <ul className="team suplist">
          {suppliers.filter((x) => x.status === "active").map((s, i) => {
            const inv = byId.get(s.id);
            return (
              <li key={s.id}>
                <span className="supwho"><span className={`av av${i % 6}`} aria-hidden="true">{s.name.slice(0, 1).toUpperCase()}</span><span><b>{s.name}</b> <span className="sub">{s.contactEmail}</span></span></span>
                <span className="actions" style={{ margin: 0 }}>
                  {inv && (() => { const st = inv.bidSubmittedAt ? ["Bid submitted", "done"] : inv.response === "declined" ? ["Declined", "bad"] : inv.response === "accepted" ? ["Will take part", "info"] : inv.status === "Expired" ? ["Expired", "warn"] : ["Invited", "warn"]; return <span className={`pill ${st[1]}`} title={inv.response === "declined" ? inv.declineReason : undefined}>{tx(locale, st[0]!)}</span>; })()}
                  <button className="btn ghost" type="button" disabled={busy !== null} onClick={() => invite(s)}>{busy === s.id ? tx(locale, "Creating...") : inv ? tx(locale, "New link") : tx(locale, "Invite")}</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
