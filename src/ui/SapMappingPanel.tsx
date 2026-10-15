"use client";
import { useState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { SapMapping } from "@/handover/sap-types";
import { saveSapMappingAction } from "../../app/configuration/actions";

/** How an award becomes an SAP purchase order: the organisation codes and the unit map. Administrators only. */
export default function SapMappingPanel({ locale, initial }: { locale: Locale; initial: SapMapping | null }) {
  const m = initial ?? { companyCode: "", purchOrg: "", purchGroup: "", plant: "", docType: "NB", uomMap: {} };
  const [f, setF] = useState({ companyCode: m.companyCode, purchOrg: m.purchOrg, purchGroup: m.purchGroup, plant: m.plant, docType: m.docType });
  const [units, setUnits] = useState(Object.entries(m.uomMap).map(([k, v]) => `${k}=${v}`).join("\n"));
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setSaved(false);
    const uomMap: Record<string, string> = {};
    for (const line of units.split("\n")) { const [k, v] = line.split("="); if (k?.trim()) uomMap[k.trim()] = (v ?? "").trim(); }
    const r = await saveSapMappingAction({ ...f, uomMap }).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (r.ok) setSaved(true); else setError(r.error);
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => { setF({ ...f, [k]: e.target.value }); setSaved(false); };
  return (
    <form className="card newform detail" style={{ maxWidth: 760 }} onSubmit={save}>
      <div className="row"><h3>{tx(locale, "SAP purchase order mapping")}</h3></div>
      <div className="sub">{tx(locale, "Turns an approved award into an SAP purchase order (JSON in the S/4HANA purchase order format, or a flat CSV). Download it from the award handover list or read it from the API with format=sap-po. Each supplier needs an SAP vendor number on its record.")}</div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <label>{tx(locale, "Company code")}<input value={f.companyCode} onChange={set("companyCode")} maxLength={4} size={6} required /></label>
        <label>{tx(locale, "Purchasing organisation")}<input value={f.purchOrg} onChange={set("purchOrg")} maxLength={4} size={6} required /></label>
        <label>{tx(locale, "Purchasing group")}<input value={f.purchGroup} onChange={set("purchGroup")} maxLength={3} size={5} required /></label>
        <label>{tx(locale, "Plant (optional)")}<input value={f.plant} onChange={set("plant")} maxLength={4} size={6} /></label>
        <label>{tx(locale, "Document type")}<input value={f.docType} onChange={set("docType")} maxLength={4} size={6} required /></label>
      </div>
      <label>{tx(locale, "Unit map: one per line, our unit = SAP unit (for example PAIR=PR)")}<textarea rows={4} value={units} onChange={(e) => { setUnits(e.target.value); setSaved(false); }} /></label>
      <div className="row"><button className="btn" type="submit" disabled={busy}>{busy ? tx(locale, "Saving...") : tx(locale, "Save mapping")}</button>{saved && <span role="status" className="sub">{tx(locale, "Saved.")}</span>}</div>
    </form>
  );
}
