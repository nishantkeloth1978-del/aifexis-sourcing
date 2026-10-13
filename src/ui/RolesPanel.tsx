"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { PERMISSIONS } from "@/access/permissions";
import type { RoleInfo } from "@/access/roles";
import { createRoleAction, deleteRoleAction, explainPersonAction, setPermissionsAction } from "../../app/roles/actions";

const GROUPS = ["Events", "Master data", "Setup", "Reporting", "People"] as const;

export default function RolesPanel({ locale, roles, people }: { locale: Locale; roles: RoleInfo[]; people: { id: string; email: string }[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(""), [base, setBase] = useState("member");
  const [who, setWho] = useState(""), [explain, setExplain] = useState<{ email: string; roleName: string; perms: string[] } | null>(null);
  async function go(fn: () => Promise<{ ok: boolean; error?: string }>) { setBusy(true); const r = await fn(); setBusy(false); setErr(r.ok ? null : (r.error ?? "That could not be saved. Try again.")); router.refresh(); return r.ok; }
  const target = (r: RoleInfo) => (r.id && !r.builtin ? { id: r.id } : { key: r.key as "member" | "integration_admin" });
  const toggle = (r: RoleInfo, perm: string) => go(() => setPermissionsAction(target(r), r.perms.includes(perm) ? r.perms.filter((p) => p !== perm) : [...r.perms, perm]));
  return (
    <>
      <p className="sub">{tx(locale, "Roles decide what a person can do in the organisation. What they can see and do on one event comes from their role on that event (Team tab), and sealed bids stay sealed whatever the role. Without \"See every event\", a person sees only the events they created or are on the team of.")}</p>
      {err && <div className="alert" role="alert">{tx(locale, err)}</div>}
      <div className="tablewrap"><table className="items">
        <thead><tr><th>{tx(locale, "Permission")}</th>{roles.map((r) => <th key={r.key} className="num"><div>{r.builtin ? tx(locale, r.name) : r.name}</div><div className="sub">{tx(locale, "{n} people", { n: r.members })}</div>
          {!r.builtin && <button className="btn ghost" type="button" disabled={busy || r.members > 0} title={r.members > 0 ? tx(locale, "People still have this role. Give them another role first.") : undefined} onClick={() => go(() => deleteRoleAction(r.id!))}>{tx(locale, "Delete role")}</button>}</th>)}</tr></thead>
        <tbody>{GROUPS.map((g) => (
          <Fragment key={g}>
            <tr><th colSpan={roles.length + 1} style={{ textAlign: "start" }}>{tx(locale, g)}</th></tr>
            {PERMISSIONS.filter((p) => p.group === g).map((p) => (
              <tr key={p.key}>
                <td><b>{tx(locale, p.label)}</b><div className="sub">{tx(locale, p.help)}</div></td>
                {roles.map((r) => {
                  const locked = r.fixed || Boolean(p.adminOnly);
                  const on = r.perms.includes(p.key);
                  return <td key={r.key} className="num"><input type="checkbox" checked={on} disabled={busy || locked} aria-label={`${r.name}: ${tx(locale, p.label)}`}
                    title={p.adminOnly && !r.fixed ? tx(locale, "Only administrators can hold this permission.") : undefined} onChange={() => toggle(r, p.key)} /></td>;
                })}
              </tr>))}
          </Fragment>))}</tbody></table></div>

      <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await go(() => createRoleAction({ name, baseRole: base, perms: [] }))) setName(""); }}>
        <h2>{tx(locale, "Create a role")}</h2>
        <div className="sub">{tx(locale, "Start with no permissions, then tick what the role needs in the table above.")}</div>
        <label>{tx(locale, "Role name")}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required /></label>
        <label>{tx(locale, "Behaves like")}<select value={base} onChange={(e) => setBase(e.target.value)}>
          <option value="member">{tx(locale, "Member")}</option><option value="integration_admin">{tx(locale, "Integration administrator")}</option></select></label>
        <button className="btn" disabled={busy}>{tx(locale, "Create role")}</button>
      </form>

      <div className="card">
        <h2>{tx(locale, "Check what a person can do")}</h2>
        <label>{tx(locale, "Person")}<select value={who} onChange={async (e) => { setWho(e.target.value); setExplain(null); if (e.target.value) { const r = await explainPersonAction(e.target.value); if (r.ok && "perms" in r) setExplain({ email: r.email, roleName: r.roleName, perms: r.perms }); } }}>
          <option value="">{tx(locale, "Choose a person")}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.email}</option>)}</select></label>
        {explain && <div><b>{explain.email}</b> <span className="sub">({explain.roleName})</span>
          <ul>{PERMISSIONS.map((p) => <li key={p.key}>{explain.perms.includes(p.key) ? "✓" : "✗"} {tx(locale, p.label)}</li>)}</ul></div>}
      </div>
    </>
  );
}
