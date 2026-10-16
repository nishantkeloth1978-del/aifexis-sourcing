"use client";
import { useState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { AribaMapping } from "@/handover/ariba-types";
import { saveAribaMappingAction } from "../../app/configuration/actions";

/** How an award becomes an Ariba purchase order (cXML OrderRequest): the buyer's identity and the unit map. Administrators only. */
export default function AribaMappingPanel({ locale, initial }: { locale: Locale; initial: AribaMapping | null }) {
  const m = initial ?? { buyerNetworkId: "", buyerName: "", shipToName: "", testMode: true, uomMap: {} };
  const [f, setF] = useState({ buyerNetworkId: m.buyerNetworkId, buyerName: m.buyerName, shipToName: m.shipToName, testMode: m.testMode });
  const [units, setUnits] = useState(Object.entries(m.uomMap).map(([k, v]) => `${k}=${v}`).join("\n"));
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setSaved(false);
    const uomMap: Record<string, string> = {};
    for (const line of units.split("\n")) { const [k, v] = line.split("="); if (k?.trim()) uomMap[k.trim()] = (v ?? "").trim(); }
    const r = await saveAribaMappingAction({ ...f, uomMap }).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (r.ok) setSaved(true); else setError(r.error);
  }
  const set = (k: "buyerNetworkId" | "buyerName" | "shipToName") => (e: React.ChangeEvent<HTMLInputElement>) => { setF({ ...f, [k]: e.target.value }); setSaved(false); };
  return (
    <form className="card newform detail" style={{ maxWidth: 760 }} onSubmit={save}>
      <div className="row"><h3>{tx(locale, "Ariba purchase order mapping")}</h3></div>
      <div className="sub">{tx(locale, "Turns an approved award into an Ariba purchase order (a cXML OrderRequest file). Download it from the award handover list or read it from the API with format=ariba-cxml. Each supplier needs its Ariba Network ID or supplier number on its record.")}</div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <label>{tx(locale, "Buyer Ariba Network ID")}<input value={f.buyerNetworkId} onChange={set("buyerNetworkId")} maxLength={40} required /></label>
        <label>{tx(locale, "Buyer name")}<input value={f.buyerName} onChange={set("buyerName")} maxLength={100} required /></label>
        <label>{tx(locale, "Ship-to name (optional)")}<input value={f.shipToName} onChange={set("shipToName")} maxLength={100} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={f.testMode} onChange={(e) => { setF({ ...f, testMode: e.target.checked }); setSaved(false); }} /> {tx(locale, "Mark files as test (deploymentMode test)")}</label>
      <label>{tx(locale, "Unit map: one per line, our unit = Ariba unit code (for example PAIR=PR)")}<textarea rows={4} value={units} onChange={(e) => { setUnits(e.target.value); setSaved(false); }} /></label>
      <div className="row"><button className="btn" type="submit" disabled={busy}>{busy ? tx(locale, "Saving...") : tx(locale, "Save mapping")}</button>{saved && <span role="status" className="sub">{tx(locale, "Saved.")}</span>}</div>
    </form>
  );
}
