"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Supplier } from "@/suppliers/service";
import type { PlannedSupplier } from "@/suppliers/plan";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { planAddAction, planRemoveAction } from "../../app/suppliers/actions";

/** Suppliers chosen on a draft event. They are invited automatically the moment the event is published. */
export default function PlanPanel({ eventId, suppliers, plan, locale = "en" }: { eventId: string; suppliers: Supplier[]; plan: PlannedSupplier[]; locale?: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const planned = useMemo(() => new Set(plan.map((p) => p.supplierId)), [plan]);
  const active = suppliers.filter((s) => s.status === "active");
  const cats = useMemo(() => [...new Set(active.map((s) => s.category.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [active]);
  const shown = active.filter((s) => !planned.has(s.id) && (!q || `${s.name} ${s.category}`.toLowerCase().includes(q.toLowerCase())));

  async function add(input: { supplierIds?: string[]; category?: string }) {
    setError(null); setBusy(true);
    const r = await planAddAction(eventId, input).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setSel(new Set()); setCat(""); router.refresh();
  }
  async function remove(id: string) {
    setError(null); setBusy(true);
    const r = await planRemoveAction(eventId, id).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) setError(r.error); else router.refresh();
  }

  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Suppliers to invite")}</h3><span className="sub">{tx(locale, "{n} chosen", { n: plan.length })}</span></div>
      <div className="sub">{tx(locale, "They receive their invitation automatically when the event is published.")}</div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      {plan.length > 0 && (
        <ul className="team suplist">
          {plan.map((p, i) => (
            <li key={p.supplierId}><span className="supwho"><span className={`av av${i % 6}`} aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span><span><b>{p.name}</b> <span className="sub">{p.category}{p.category && p.email ? " · " : ""}{p.email}</span></span></span>
              <span className="actions" style={{ margin: 0 }}>{p.category && <span className="pill info">{p.category}</span>}<button className="btn ghost" type="button" disabled={busy} onClick={() => remove(p.supplierId)}>{tx(locale, "Remove")}</button></span></li>
          ))}
        </ul>
      )}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <select aria-label={tx(locale, "Category")} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">{tx(locale, "Choose a category")}</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn ghost" type="button" disabled={busy || !cat} onClick={() => add({ category: cat })}>{tx(locale, "Add the whole category")}</button>
      </div>
      <input type="search" placeholder={tx(locale, "Search suppliers")} aria-label={tx(locale, "Search suppliers")} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginTop: 8 }} />
      {shown.length === 0 ? <div className="sub" style={{ marginTop: 8 }}>{active.length === 0 ? tx(locale, "Add suppliers first on the Suppliers page.") : tx(locale, "No more suppliers to add.")}</div> : (
        <ul className="team suplist" style={{ maxHeight: 280, overflowY: "auto" }}>
          {shown.map((s, i) => (
            <li key={s.id}>
              <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={sel.has(s.id)} onChange={(e) => setSel((x) => { const n = new Set(x); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} />
                <span className="supwho"><span className={`av av${i % 6}`} aria-hidden="true">{s.name.slice(0, 1).toUpperCase()}</span><span><b>{s.name}</b> <span className="sub">{s.category}{s.category && s.contactEmail ? " · " : ""}{s.contactEmail}</span></span></span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="actions"><button className="btn" type="button" disabled={busy || sel.size === 0} onClick={() => add({ supplierIds: [...sel] })}>{tx(locale, "Add selected")}</button></div>
    </div>
  );
}
