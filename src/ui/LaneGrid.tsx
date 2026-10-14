"use client";
import type { Dispatch, SetStateAction } from "react";
import { formatDec, parseDec, rescale } from "@/engine/decimal";
import { lineAmount } from "@/boq/amount";
import type { BidForm as Form } from "@/bids/service";
import { laneHasPrice, meetsLimit, type Lane, type LaneTerms } from "@/bids/lanes";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { lab } from "./lab";

type Status = "empty" | "partial" | "full";

/** The supplier's lane table: one row per lane, the buyer's facts fixed, the supplier's prices and lane facts in input cells. */
export default function LaneGrid({ form, locale, prices, setPrices, terms, setTerms }: {
  form: Form; locale: Locale; prices: Record<string, string>; setPrices: Dispatch<SetStateAction<Record<string, string>>>;
  terms: LaneTerms; setTerms: Dispatch<SetStateAction<LaneTerms>>;
}) {
  const grid = form.laneGrid!;
  const open = form.open;
  const cur = form.event.currency;
  const itemById = new Map(form.items.map((i) => [i.id, i]));
  const shownBuyer = grid.buyerCols.filter((c) => !grid.nameKeys.includes(c.key));
  const money = (v: bigint | null) => (v === null ? "-" : formatDec(v, 2));

  const calc = (lane: Lane): { status: Status; allIn: bigint | null; annual: bigint | null; missing: number } => {
    const comps = grid.components.map((k) => ({ k, id: lane.items[k.lineKey]! }));
    const filled = comps.filter((c) => (prices[c.id] ?? "").trim() !== "");
    if (!filled.length) return { status: "empty", allIn: null, annual: null, missing: comps.length };
    let allIn = 0n, annual = 0n, bad = 0;
    for (const c of comps) {
      const it = itemById.get(c.id)!;
      const a = lineAmount({ ...it, zeroOk: it.zeroOk }, prices, {});
      if (a === null) { bad++; continue; }
      annual += a;
      if ((prices[c.id] ?? "") !== "NB") allIn += parseDec(prices[c.id]!, 4) ?? 0n;
    }
    return { status: bad ? "partial" : "full", allIn: bad ? null : allIn, annual: bad ? null : annual, missing: bad };
  };
  const rows = grid.lanes.map((lane) => ({ lane, ...calc(lane) }));
  const priced = rows.filter((r) => r.status === "full").length, partial = rows.filter((r) => r.status === "partial").length;
  const setPrice = (id: string, v: string) => setPrices((p) => ({ ...p, [id]: v }));
  const setTerm = (laneKey: string, key: string, v: string) => setTerms((t) => ({ ...t, [laneKey]: { ...(t[laneKey] ?? {}), [key]: v } }));
  const clear = (lane: Lane) => {
    setPrices((p) => { const n = { ...p }; for (const id of Object.values(lane.items)) delete n[id]; return n; });
    setTerms((t) => { const n = { ...t }; delete n[lane.key]; return n; });
  };

  return (
    <div>
      <div className="sub" role="status" aria-live="polite">
        {tx(locale, "{n} of {m} lanes priced.", { n: priced, m: grid.lanes.length })}{partial > 0 && <span className="lotwarn"> {tx(locale, "Incomplete lanes: {n}.", { n: partial })}</span>}{" "}
        {tx(locale, "Leave a lane empty if you do not bid on it. If you bid on a lane, price every column and give its transit time.")}
      </div>
      <div className="tablewrap"><table className="items lanegrid">
        <caption className="sr-only">{tx(locale, "Lane prices")}</caption>
        <thead><tr>
          <th scope="col">#</th><th scope="col">{tx(locale, "Route")}</th>
          {shownBuyer.map((c) => <th key={c.key} scope="col" className={c.type === "integer" || c.type === "decimal" ? "num" : undefined}>{lab(c.label, locale)}</th>)}
          {grid.components.map((k) => <th key={k.lineKey} scope="col" className="num">{lab(k.label, locale)}{cur && <span className="sub"> ({cur})</span>}</th>)}
          <th scope="col" className="num">{tx(locale, "All-in price")}</th><th scope="col" className="num">{tx(locale, "Annual cost")}</th>
          {grid.answers.map((a) => <th key={a.key} scope="col">{lab(a.label, locale)}{a.required ? " *" : ""}</th>)}
          <th scope="col">{tx(locale, "Status")}</th>
        </tr></thead>
        <tbody>
          {rows.map(({ lane, status, allIn, annual }) => {
            const meets = meetsLimit(grid, lane, terms[lane.key]);
            return (
              <tr key={lane.key} className={status === "empty" ? "lanerow nobid" : "lanerow"}>
                <td>{lane.no}</td><th scope="row" className="lanename">{lane.name}</th>
                {shownBuyer.map((c) => <td key={c.key} className={c.type === "integer" || c.type === "decimal" ? "num fixed" : "fixed"}>{lane.buyer[c.key] || "-"}</td>)}
                {grid.components.map((k) => { const id = lane.items[k.lineKey]!; const v = prices[id] ?? ""; return (
                  <td key={k.lineKey} className="num"><input className="priceinput" inputMode="decimal" disabled={!open} aria-label={`${lab(k.label, locale)}, ${tx(locale, "lane")} ${lane.no}`}
                    placeholder={k.zeroOk ? "0" : ""} value={v === "NB" ? "0" : v} onChange={(e) => setPrice(id, e.target.value)} /></td>); })}
                <td className="num calc"><b>{money(allIn === null ? null : rescale(allIn, 4, 2))}</b></td><td className="num calc">{money(annual)}</td>
                {grid.answers.map((a) => (
                  <td key={a.key}><input className="priceinput" disabled={!open} aria-label={`${lab(a.label, locale)}, ${tx(locale, "lane")} ${lane.no}`}
                    type={a.type === "date" ? "date" : "text"} inputMode={a.type === "integer" || a.type === "decimal" ? "decimal" : undefined}
                    value={terms[lane.key]?.[a.key] ?? ""} onChange={(e) => setTerm(lane.key, a.key, e.target.value)} /></td>))}
                <td>
                  {status === "empty" ? <span className="sub">{tx(locale, "No bid")}</span> : status === "partial" ? <span className="lotwarn">{tx(locale, "Incomplete")}</span> : <span className="sub">{tx(locale, "Priced")}</span>}
                  {laneHasPrice(lane, prices) && meets !== null && <div><span className={meets ? "chip ok" : "chip no"}>{meets ? tx(locale, "Meets transit") : tx(locale, "Over the transit limit")}</span></div>}
                  {open && laneHasPrice(lane, prices) && <div><button type="button" className="sublink" onClick={() => clear(lane)}>{tx(locale, "Clear lane")}</button></div>}
                </td>
              </tr>);
          })}
        </tbody>
      </table></div>
    </div>
  );
}
