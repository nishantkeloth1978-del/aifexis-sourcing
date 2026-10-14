"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { PERMISSIONS } from "@/access/permissions";
import type { RoleInfo } from "@/access/roles";
import { createRoleAction, deleteRoleAction, explainPersonAction, setPermissionsAction } from "../../app/roles/actions";

const GROUPS = ["Events", "Master data", "Setup", "Reporting", "People"] as const;
type Panel = { mode: "edit"; role: RoleInfo } | { mode: "new" } | null;

export default function RolesPanel({ locale, roles, people }: { locale: Locale; roles: RoleInfo[]; people: { id: string; email: string }[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [name, setName] = useState(""), [desc, setDesc] = useState(""), [base, setBase] = useState("member");
  const [who, setWho] = useState(""), [explain, setExplain] = useState<{ email: string; roleName: string; perms: string[] } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const total = PERMISSIONS.length;
  const label = (r: RoleInfo) => (r.builtin ? tx(locale, r.name) : r.name);

  const drawerRef = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  const isOpen = panel !== null;
  useEffect(() => {
    if (!isOpen) return;
    opener.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setPanel(null); return; }
      if (e.key !== "Tab" || !drawerRef.current) return;
      // keep keyboard focus inside the open panel
      const f = [...drawerRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])")];
      if (!f.length) return;
      const first = f[0]!, last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); (opener.current as HTMLElement | null)?.focus?.(); };
  }, [isOpen]);

  function open(p: Panel) {
    setErr(null);
    if (p?.mode === "edit") setDraft(new Set(p.role.perms));
    if (p?.mode === "new") { setDraft(new Set()); setName(""); setDesc(""); setBase("member"); }
    setPanel(p);
  }
  const target = (r: RoleInfo) => (r.id && !r.builtin ? { id: r.id } : { key: r.key as "member" | "integration_admin" });
  const dirty = panel?.mode === "edit" ? draft.size !== panel.role.perms.length || panel.role.perms.some((p) => !draft.has(p)) : true;
  const flip = (k: string) => setDraft((d) => { const n = new Set(d); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  async function save() {
    if (!panel) return;
    setBusy(true); setErr(null);
    const r = panel.mode === "edit"
      ? await setPermissionsAction(target(panel.role), [...draft])
      : await createRoleAction({ name, description: desc || undefined, baseRole: base, perms: [...draft] });
    setBusy(false);
    if (!r.ok) { setErr(("error" in r && r.error) || "That could not be saved. Try again."); return; }
    setPanel(null); router.refresh();
  }
  async function remove(r: RoleInfo) {
    setBusy(true); setErr(null);
    const res = await deleteRoleAction(r.id!);
    setBusy(false);
    if (!res.ok) { setErr(("error" in res && res.error) || "That could not be saved. Try again."); return; }
    setPanel(null); router.refresh();
  }

  const editRole = panel?.mode === "edit" ? panel.role : null;
  const locked = (adminOnly?: boolean) => Boolean(editRole?.fixed) || Boolean(adminOnly);

  return (
    <>
      <p className="sub">{tx(locale, "Roles decide what a person can do in the organisation. What they can see and do on one event comes from their role on that event (Team tab), and sealed bids stay sealed whatever the role. Without \"See every event\", a person sees only the events they created or are on the team of.")}</p>
      {err && !panel && <div className="alert" role="alert">{tx(locale, err)}</div>}

      <div className="rolecards">
        {roles.map((r) => {
          const n = r.perms.length;
          return (
            <button key={r.key} type="button" className="card rolecard" onClick={() => open({ mode: "edit", role: r })}>
              <span className="row"><b className="rolename">{label(r)}</b>{r.fixed ? <span className="pill">{tx(locale, "Fixed")}</span> : !r.builtin ? <span className="pill live">{tx(locale, "Custom")}</span> : null}</span>
              <span className="sub">{r.description ? (r.builtin ? tx(locale, r.description) : r.description) : (r.builtin ? "" : tx(locale, "Custom role"))}</span>
              <span className="rolebar" aria-hidden="true"><i style={{ width: `${Math.round((n / total) * 100)}%` }} /></span>
              <span className="sub">{tx(locale, "{n} of {total} permissions", { n, total })} · {tx(locale, "{n} people", { n: r.members })}</span>
              <span className="rolegroups">{GROUPS.map((g) => { const k = PERMISSIONS.filter((p) => p.group === g && r.perms.includes(p.key)).length; return k ? <span className="pill" key={g}>{tx(locale, g)} {k}</span> : null; })}</span>
            </button>
          );
        })}
        <button type="button" className="rolecard rolenew" onClick={() => open({ mode: "new" })}>+ {tx(locale, "New role")}</button>
      </div>

      {panel && (
        <>
          <div className="drawerback" aria-hidden="true" onClick={() => setPanel(null)} />
          <aside ref={drawerRef} className="drawer" role="dialog" aria-modal="true" aria-label={editRole ? label(editRole) : tx(locale, "New role")}>
            <div className="drawerhd">
              <div>
                <b>{editRole ? label(editRole) : tx(locale, "New role")}</b>
                <div className="sub">{tx(locale, "{n} of {total} permissions on", { n: draft.size, total })}{editRole?.fixed ? ` · ${tx(locale, "The administrator role cannot be changed.")}` : ""}</div>
              </div>
              <button ref={closeRef} className="btn ghost" type="button" onClick={() => setPanel(null)}>{tx(locale, "Close")}</button>
            </div>
            <div className="drawerbd">
              {panel.mode === "new" && (
                <div className="drawerform">
                  <label>{tx(locale, "Role name")}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required /></label>
                  <label>{tx(locale, "Description")}<input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} /></label>
                  <label>{tx(locale, "Behaves like")}<select value={base} onChange={(e) => setBase(e.target.value)}>
                    <option value="member">{tx(locale, "Member")}</option><option value="integration_admin">{tx(locale, "Integration administrator")}</option></select></label>
                </div>
              )}
              {GROUPS.map((g) => (
                <div key={g}>
                  <div className="permgroup">{tx(locale, g)}</div>
                  {PERMISSIONS.filter((p) => p.group === g).map((p) => {
                    const lk = locked(p.adminOnly);
                    return (
                      <label key={p.key} className="permrow" title={p.adminOnly && !editRole?.fixed ? tx(locale, "Only administrators can hold this permission.") : undefined}>
                        <span><b>{tx(locale, p.label)}</b>{p.adminOnly && !editRole?.fixed && <span className="pill"> {tx(locale, "Admin only")}</span>}<span className="sub">{tx(locale, p.help)}</span></span>
                        <span className="switch"><input type="checkbox" checked={editRole?.fixed ? true : draft.has(p.key)} disabled={busy || lk} onChange={() => flip(p.key)} aria-label={tx(locale, p.label)} /><i /></span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="drawerft">
              {err && <div className="alert" role="alert" style={{ flex: 1 }}>{tx(locale, err)}</div>}
              {editRole && !editRole.builtin && (
                <button className="btn ghost" type="button" disabled={busy || editRole.members > 0} title={editRole.members > 0 ? tx(locale, "People still have this role. Give them another role first.") : undefined} onClick={() => remove(editRole)}>{tx(locale, "Delete role")}</button>
              )}
              <button className="btn ghost" type="button" onClick={() => setPanel(null)}>{tx(locale, "Cancel")}</button>
              {!editRole?.fixed && <button className="btn" type="button" disabled={busy || !dirty || (panel.mode === "new" && name.trim().length < 2)} onClick={save}>{busy ? tx(locale, "Saving...") : panel.mode === "new" ? tx(locale, "Create role") : tx(locale, "Save changes")}</button>}
            </div>
          </aside>
        </>
      )}

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
