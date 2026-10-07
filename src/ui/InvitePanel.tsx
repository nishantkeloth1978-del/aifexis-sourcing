"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InvitationRow, Supplier } from "@/suppliers/service";
import { inviteAction } from "../../app/suppliers/actions";

export default function InvitePanel({ eventId, suppliers, invitations }: { eventId: string; suppliers: Supplier[]; invitations: InvitationRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const byId = new Map(invitations.map((i) => [i.supplierId, i]));

  async function invite(s: Supplier) {
    setError(null); setBusy(s.id); setCopied(false);
    const res = await inviteAction(eventId, s.id).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    setLink({ name: s.name, url: `${window.location.origin}/invite/${res.token}` });
    router.refresh();
  }
  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <div className="card detail">
      <div className="row"><h3>Suppliers</h3><span className="sub">{invitations.length} invited</span></div>
      {error && <div className="alert" role="alert">{error}</div>}
      {link && (
        <div className="linkbox">
          <div><b>Invitation link for {link.name}</b> (shown once, valid 14 days). Send it to the supplier's contact.</div>
          <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
          <div className="actions"><button className="btn" type="button" onClick={copy}>{copied ? "Copied" : "Copy link"}</button><button className="btn ghost" type="button" onClick={() => setLink(null)}>Done</button></div>
        </div>
      )}
      {suppliers.length === 0 ? <div className="sub">Add suppliers first on the Suppliers page.</div> : (
        <ul className="team">
          {suppliers.map((s) => {
            const inv = byId.get(s.id);
            return (
              <li key={s.id}>
                <span><b>{s.name}</b> <span className="sub">{s.contactEmail}</span></span>
                <span className="actions" style={{ margin: 0 }}>
                  {inv && <span className="sub">{inv.status}</span>}
                  <button className="btn ghost" type="button" disabled={busy !== null} onClick={() => invite(s)}>{busy === s.id ? "Creating..." : inv ? "New link" : "Invite"}</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
