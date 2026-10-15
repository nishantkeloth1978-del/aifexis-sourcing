"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { createRequestAction } from "../../app/requests/actions";

interface Line { description: string; quantity: string; unit: string }
const EMPTY: Line = { description: "", quantity: "1", unit: "EA" };

/** A purchase or service request: what is needed, roughly when and how much. A buyer turns it into a sourcing event. */
export default function RequestForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [kind, setKind] = useState("goods");
  const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [dept, setDept] = useState("");
  const [neededBy, setNeededBy] = useState(""); const [estValue, setEstValue] = useState(""); const [currency, setCurrency] = useState("AED");
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY }]);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const filled = lines.filter((l) => l.description.trim() !== "");
    const r = await createRequestAction({ kind, title, description, ownerDept: dept, neededBy: neededBy || undefined, estValue: estValue || undefined, currency, lines: filled }).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (r.ok) router.push(`/requests/${r.request.id}`); else setError(r.error);
  }
  return (
    <form className="card newform detail" onSubmit={submit} style={{ maxWidth: 760 }}>
      <div className="sub">{tx(locale, "Describe what you need. A buyer will review it and turn it into a sourcing event.")}</div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      <label>{tx(locale, "Type")}<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="goods">{tx(locale, "Goods")}</option><option value="service">{tx(locale, "Service")}</option></select></label>
      <label>{tx(locale, "Title")}<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required /></label>
      <label>{tx(locale, "Description")}<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={4000} /></label>
      <div className="row" style={{ flexWrap: "wrap", gap: 16 }}>
        <label>{tx(locale, "Department")}<input value={dept} onChange={(e) => setDept(e.target.value)} maxLength={100} /></label>
        <label>{tx(locale, "Needed by")}<input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></label>
        <label>{tx(locale, "Estimated value")}<input inputMode="decimal" value={estValue} onChange={(e) => setEstValue(e.target.value)} /></label>
        <label>{tx(locale, "Currency")}<input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} style={{ width: 80 }} /></label>
      </div>
      <h4>{tx(locale, "Lines")}</h4>
      {lines.map((l, i) => (
        <div key={i} className="row" style={{ flexWrap: "wrap", gap: 10, alignItems: "end" }}>
          <label style={{ flex: "1 1 260px" }}>{tx(locale, "Description")}<input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} maxLength={500} /></label>
          <label>{tx(locale, "Quantity")}<input inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} style={{ width: 100 }} /></label>
          <label>{tx(locale, "Unit")}<input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} maxLength={20} style={{ width: 90 }} /></label>
          {lines.length > 1 && <button type="button" className="btn ghost" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>{tx(locale, "Remove")}</button>}
        </div>))}
      {lines.length < 50 && <div><button type="button" className="btn ghost" onClick={() => setLines((ls) => [...ls, { ...EMPTY }])}>{tx(locale, "Add a line")}</button></div>}
      <div className="row" style={{ marginTop: 12 }}><button className="btn" type="submit" disabled={busy}>{busy ? tx(locale, "Saving...") : tx(locale, "Submit request")}</button></div>
    </form>
  );
}
