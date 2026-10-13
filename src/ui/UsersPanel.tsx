"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import { dateLocale, type Locale } from "@/i18n/dict";
import type { Member, PendingInvite } from "@/users/service";
import { inviteAction, revokeInviteAction, setActiveAction, updateMemberAction } from "../../app/users/actions";

const ROLES: [string, string][] = [["admin", "Administrator"], ["member", "Member"], ["integration_admin", "Integration administrator"]];
const roleLabel = (l: Locale, r: string) => tx(l, ROLES.find((x) => x[0] === r)?.[1] ?? r);

function MemberRow({ m, me, locale, onErr }: { m: Member; me: boolean; locale: Locale; onErr: (e: string | null) => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(m.title ?? "");
  const [dept, setDept] = useState(m.department ?? "");
  const [busy, setBusy] = useState(false);
  async function go(fn: () => Promise<{ ok: boolean; error?: string }>) { setBusy(true); const r = await fn(); setBusy(false); onErr(r.ok ? null : (r.error ?? "That could not be saved. Try again.")); router.refresh(); }
  return (
    <tr className={m.active ? "" : "off"}>
      <td><b>{m.email}</b>{me && <span className="chip"> {tx(locale, "You")}</span>}<div className="sub">{m.joined ? tx(locale, "Signed in before") : tx(locale, "Has not signed in yet")}{!m.active && ` · ${tx(locale, "Switched off")}`}</div></td>
      <td><select aria-label={tx(locale, "Role")} value={m.role} disabled={busy} onChange={(e) => go(() => updateMemberAction(m.membershipId, { role: e.target.value }))}>{ROLES.map(([k, l]) => <option key={k} value={k}>{tx(locale, l)}</option>)}</select></td>
      <td><input aria-label={tx(locale, "Job title")} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} onBlur={() => { if (title !== (m.title ?? "")) void go(() => updateMemberAction(m.membershipId, { title })); }} /></td>
      <td><input aria-label={tx(locale, "Department")} value={dept} maxLength={80} onChange={(e) => setDept(e.target.value)} onBlur={() => { if (dept !== (m.department ?? "")) void go(() => updateMemberAction(m.membershipId, { department: dept })); }} /></td>
      <td className="sub">{m.eventRoles}</td>
      <td>{!me && <button className="btn ghost" type="button" disabled={busy} onClick={() => go(() => setActiveAction(m.membershipId, !m.active))}>{m.active ? tx(locale, "Switch off") : tx(locale, "Switch on")}</button>}</td>
    </tr>
  );
}

export default function UsersPanel({ locale, members, invites, meId }: { locale: Locale; members: Member[]; invites: PendingInvite[]; meId: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function invite(fd: FormData) {
    setBusy(true); setErr(null);
    const email = String(fd.get("email") ?? "");
    const r = await inviteAction({ email, role: String(fd.get("role") ?? "member"), title: String(fd.get("title") ?? ""), department: String(fd.get("department") ?? "") });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setLink({ email, url: `${window.location.origin}/join/${r.token}` });
    router.refresh();
  }
  return (
    <div>
      <section className="card" style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>{tx(locale, "Invite a person")}</h2>
        <p className="sub">{tx(locale, "They receive a link by e-mail. You can also copy it and send it yourself. After they join, give them event roles in the Team tab of each event.")}</p>
        <form action={invite} className="additem" style={{ flexWrap: "wrap" }}>
          <input name="email" type="email" required placeholder={tx(locale, "E-mail address")} aria-label={tx(locale, "E-mail address")} />
          <select name="role" defaultValue="member" aria-label={tx(locale, "Role")}>{ROLES.map(([k, l]) => <option key={k} value={k}>{tx(locale, l)}</option>)}</select>
          <input name="title" maxLength={80} placeholder={tx(locale, "Job title (optional)")} aria-label={tx(locale, "Job title")} />
          <input name="department" maxLength={80} placeholder={tx(locale, "Department (optional)")} aria-label={tx(locale, "Department")} />
          <button className="btn" type="submit" disabled={busy}>{tx(locale, "Send invitation")}</button>
        </form>
        {err && <div className="alert" role="alert">{tx(locale, err)}</div>}
        {link && <div className="okbox"><b>{tx(locale, "Invitation link for {e}", { e: link.email })}</b><div className="sub" style={{ wordBreak: "break-all" }}>{link.url}</div>
          <div className="actions"><button className="btn ghost" type="button" onClick={() => navigator.clipboard?.writeText(link.url)}>{tx(locale, "Copy link")}</button></div>
          <div className="sub">{tx(locale, "This link is shown only now. It works for 14 days.")}</div></div>}
      </section>

      {invites.length > 0 && <section className="card" style={{ padding: 16, marginTop: 12 }}>
        <h2 style={{ marginTop: 0 }}>{tx(locale, "Waiting to join")}</h2>
        <table className="tbl"><tbody>{invites.map((i) => (
          <tr key={i.id}><td><b>{i.email}</b></td><td>{roleLabel(locale, i.role)}</td><td className="sub">{i.expired ? tx(locale, "Expired") : tx(locale, "Expires {d}", { d: new Date(i.expiresAt).toLocaleDateString(dateLocale(locale), { day: "numeric", month: "short" }) })}</td>
            <td><button className="btn ghost" type="button" onClick={async () => { const r = await revokeInviteAction(i.id); if (!r.ok) setErr(r.error); router.refresh(); }}>{tx(locale, "Cancel invitation")}</button></td></tr>))}</tbody></table>
      </section>}

      <section className="card" style={{ padding: 16, marginTop: 12 }}>
        <h2 style={{ marginTop: 0 }}>{tx(locale, "People")}</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead><tr><th>{tx(locale, "Person")}</th><th>{tx(locale, "Role")}</th><th>{tx(locale, "Job title")}</th><th>{tx(locale, "Department")}</th><th>{tx(locale, "Event roles")}</th><th /></tr></thead>
            <tbody>{members.map((m) => <MemberRow key={m.membershipId} m={m} me={m.membershipId === meId} locale={locale} onErr={setErr} />)}</tbody>
          </table>
        </div>
        <p className="sub">{tx(locale, "Switching someone off stops them signing in at once. Their past work, scores and approvals stay in the record. The organisation always keeps at least one administrator.")}</p>
      </section>
    </div>
  );
}
