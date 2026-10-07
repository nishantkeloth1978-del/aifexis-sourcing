"use client";
import { useMemo, useRef, useState } from "react";
import { formatDec, parseDec, rescale } from "@/engine/decimal";
import type { BidForm as Form } from "@/bids/service";
import { importPricesAction, submitBidAction } from "../../app/supplier/events/[id]/actions";

export default function BidForm({ form }: { form: Form }) {
  const [prices, setPrices] = useState<Record<string, string>>(form.prices);
  const [text, setText] = useState(form.technicalText);
  const [revision, setRevision] = useState(form.revisionNo);
  const [saved, setSaved] = useState<string | null>(form.total);
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [gates, setGates] = useState<Record<string, boolean>>(form.gateAnswers);
  const [sheetMsg, setSheetMsg] = useState<{ ok: boolean; text: string; errors?: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const key = useRef(crypto.randomUUID());

  // The total updates as you type. The server recalculates it from the prices on submit.
  const total = useMemo(() => {
    let t = 0n;
    for (const it of form.items) {
      const p = parseDec(prices[it.id] ?? "", 4); if (p === null) return null;
      const q = parseDec(it.quantity, 3) ?? 0n;
      t += it.blockType === "LUMP_SUM" ? rescale(p, 4, 2) : rescale(p * q, 7, 2);
    }
    return t;
  }, [prices, form.items]);

  const dirty = saved === null || JSON.stringify(prices) !== JSON.stringify(form.prices) || JSON.stringify(gates) !== JSON.stringify(form.gateAnswers) || text !== form.technicalText || revision !== form.revisionNo;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setState("sending");
    const res = await submitBidAction(form.event.id, { prices, technicalText: text, gates, idempotencyKey: key.current }).catch(() => ({ ok: false as const, error: "That could not be submitted. Try again." }));
    setState("idle");
    if (!res.ok) { setError(res.error); return; }
    setRevision(res.revisionNo); setSaved(res.total); key.current = crypto.randomUUID();
  }
  async function pickSheet(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setSheetMsg(null);
    const fd = new FormData(); fd.set("file", f);
    const r = await importPricesAction(form.event.id, fd).catch(() => ({ ok: false as const, error: "That file could not be read." }));
    if (!r.ok) { setSheetMsg({ ok: false, text: r.error }); return; }
    setPrices((p) => ({ ...p, ...r.prices }));
    setSheetMsg({ ok: r.errors.length === 0, text: `${r.filled} ${r.filled === 1 ? "price" : "prices"} loaded from the sheet. Check them, then submit.`, errors: r.errors.slice(0, 6).map((x) => `Row ${x.row}: ${x.message}`) });
  }
  const closes = form.event.closesAt ? new Date(form.event.closesAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "no closing date";
  const cur = form.event.currency;

  return (
    <form onSubmit={submit} className="bidform">
      <div className="card"><div className="row"><h3>{form.event.ref}</h3><span className="sub">Closes {closes}</span></div><div>{form.event.title}</div>
        {revision > 0 && <div className="okbox">Revision {revision} submitted{saved ? `, total ${cur} ${formatDec(parseDec(saved, 2), 2)}` : ""}. You can revise it until the closing time. <a className="sublink" href={`/supplier/events/${form.event.id}/receipt`}>View receipt</a></div>}
        {!form.open && <div className="alert">{form.closedReason}</div>}
      </div>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="card detail">
        <h3>1. Technical response</h3>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} disabled={!form.open} placeholder="Describe your offer: scope, compliance with the specification, delivery, warranty..." />
        {form.gates.length > 0 && (<>
          <h3>Mandatory declarations</h3>
          {form.gates.map((g) => (
            <div className="row" key={g}><span>{g}</span>
              <span className="actions" style={{ margin: 0 }}>
                {[true, false].map((v) => <label key={String(v)} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><input type="radio" name={`gate-${g}`} disabled={!form.open} checked={gates[g] === v} onChange={() => setGates((x) => ({ ...x, [g]: v }))} />{v ? "Yes" : "No"}</label>)}
              </span></div>
          ))}
        </>)}
        <h3>{form.gates.length > 0 ? "3" : "2"}. Prices {cur && <span className="sub">({cur})</span>}</h3>
        {form.open && <div className="actions" style={{ marginTop: 0 }}>
          <input ref={file} type="file" hidden accept=".xlsx" onChange={pickSheet} />
          <a className="sublink" href={`/api/supplier/events/${form.event.id}/price-sheet`}>Download price sheet</a>
          <button type="button" className="btn ghost" onClick={() => file.current?.click()}>Upload filled sheet</button>
        </div>}
        {sheetMsg && <div className={sheetMsg.ok ? "okbox" : "alert"} role="status">{sheetMsg.text}{sheetMsg.errors && sheetMsg.errors.length > 0 && <ul className="errlist">{sheetMsg.errors.map((m, i) => <li key={i}>{m}</li>)}</ul>}</div>}
        <div className="tablewrap"><table className="items"><thead><tr><th>#</th><th>Item</th><th className="num">Qty</th><th>Unit</th><th className="num">{"Price"}</th></tr></thead><tbody>
          {form.items.map((it) => (
            <tr key={it.id}><td>{it.lineNo}</td><td>{it.description}{it.blockType === "LUMP_SUM" && <span className="sub"> (lump sum)</span>}</td><td className="num">{it.quantity}</td><td>{it.unit}</td>
              <td className="num"><input className="priceinput" inputMode="decimal" aria-label={`Price for line ${it.lineNo}`} value={prices[it.id] ?? ""} disabled={!form.open}
                onChange={(e) => setPrices((p) => ({ ...p, [it.id]: e.target.value }))} /></td></tr>
          ))}
        </tbody></table></div>
        <div className="row"><b>Total</b><b>{total === null ? "Enter every price" : `${cur} ${formatDec(total, 2)}`}</b></div>
        {form.open && <div className="actions"><button className="btn" type="submit" disabled={state === "sending" || total === null || !dirty}>{state === "sending" ? "Submitting..." : revision > 0 ? "Submit revision" : "Submit bid"}</button></div>}
      </div>
    </form>
  );
}
