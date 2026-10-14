"use client";
import { formatDec, parseDec } from "@/engine/decimal";
import type { LaneMatrix } from "@/commercial/lanes";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { lab } from "./lab";

const money = (s: string | null | undefined) => { const v = s ? parseDec(s, 2) : null; return v === null || v === undefined ? "-" : formatDec(v, 2); };

/** Freight lanes side by side for the buyer: price by carrier for every lane, lane terms, and the cost of splitting the award. */
export default function LaneMatrixPanel({ m, locale, currency, canPick, onPickLowest, onPickAll }: {
  m: LaneMatrix; locale: Locale; currency: string; canPick: boolean;
  onPickLowest: () => void; onPickAll: (supplierId: string) => void;
}) {
  const extra = m.buyerCols.filter((c) => !m.nameKeys.includes(c.key) && (c.type === "integer" || c.type === "decimal"));
  const transit = m.limit?.answer;
  const everything = m.single;
  return (
    <div>
      <h4 style={{ margin: "14px 0 4px" }}>{tx(locale, "Lanes side by side")} <span className="sub">({currency}, {tx(locale, "all-in price per unit")})</span></h4>
      <div className="lanekpi">
        <div><span className="sub">{tx(locale, "Best single carrier")}</span><b>{m.bestSingle ? m.bestSingle.name : "-"}</b>{m.bestSingle ? money(m.bestSingle.annual) : tx(locale, "No carrier priced every lane")}</div>
        <div><span className="sub">{tx(locale, "Award lane by lane (lowest price each)")}</span><b>{m.byLane.annual ? money(m.byLane.annual) : "-"}</b>{m.byLane.annual ? tx(locale, "{n} carriers", { n: m.byLane.carriers }) : tx(locale, "{n} of {m} lanes have a bid", { n: m.byLane.lanesCovered, m: m.byLane.lanes })}</div>
        <div><span className="sub">{tx(locale, "Saving from splitting by lane")}</span><b>{m.saving ? money(m.saving) : "-"}</b>{m.saving && m.bestSingle?.annual ? `${(Number(parseDec(m.saving, 2)! * 10000n / parseDec(m.bestSingle.annual, 2)!) / 100).toFixed(1)}%` : ""}</div>
      </div>
      <div className="tablewrap"><table className="items lanematrix">
        <caption className="sr-only">{tx(locale, "Lanes side by side")}</caption>
        <thead><tr><th scope="col">#</th><th scope="col">{tx(locale, "Route")}</th>{extra.map((c) => <th key={c.key} scope="col" className={c.type === "integer" || c.type === "decimal" ? "num" : undefined}>{lab(c.label, locale)}</th>)}
          {m.suppliers.map((s) => <th key={s.supplierId} scope="col" className="num">{s.name}</th>)}</tr></thead>
        <tbody>{m.rows.map((r) => (
          <tr key={r.key}><td>{r.no}</td><th scope="row" style={{ textAlign: "start", fontWeight: 600 }}>{r.name}</th>
            {extra.map((c) => <td key={c.key} className={c.type === "integer" || c.type === "decimal" ? "num" : undefined}>{r.buyer[c.key] || "-"}</td>)}
            {m.suppliers.map((s) => { const c = r.cells[s.supplierId]!; return (
              <td key={s.supplierId} className={"num" + (c.priced && r.lowest === s.supplierId ? " best" : "")}>
                {c.priced ? <>{money(c.allIn)}{transit && c.terms[transit] && <div className="sub">{c.terms[transit]} {tx(locale, "days")}{c.meets === false && <span className="chip no"> {tx(locale, "Over the transit limit")}</span>}</div>}
                  {r.lowest === s.supplierId && <span className="spread">{tx(locale, "Lowest")}</span>}</> : <span className="sub">{tx(locale, "No bid")}</span>}
              </td>); })}
          </tr>))}
        </tbody>
      </table></div>
      <details><summary>{tx(locale, "Lane terms by carrier")}</summary>
        <div className="tablewrap"><table className="items lanematrix">
          <thead><tr><th scope="col">#</th><th scope="col">{tx(locale, "Route")}</th>{m.suppliers.map((s) => <th key={s.supplierId} scope="col">{s.name}</th>)}</tr></thead>
          <tbody>{m.rows.map((r) => (
            <tr key={r.key}><td>{r.no}</td><th scope="row" style={{ textAlign: "start", fontWeight: 600 }}>{r.name}</th>
              {m.suppliers.map((s) => { const c = r.cells[s.supplierId]!; return <td key={s.supplierId} className="sub2">{c.priced ? m.answers.map((a) => c.terms[a.key] ? <div key={a.key}>{lab(a.label, locale)}: {c.terms[a.key]}</div> : null) : "-"}</td>; })}
            </tr>))}</tbody>
        </table></div>
      </details>
      <h4 style={{ margin: "14px 0 4px" }}>{tx(locale, "Award scenarios")}</h4>
      <div className="tablewrap"><table className="items">
        <thead><tr><th scope="col">{tx(locale, "Scenario")}</th><th scope="col" className="num">{tx(locale, "Annual cost")}</th><th scope="col">{tx(locale, "Carriers")}</th><th scope="col"><span className="sr-only">{tx(locale, "Actions")}</span></th></tr></thead>
        <tbody>
          {everything.map((s) => (
            <tr key={s.supplierId}><td>{tx(locale, "Everything to {name}", { name: s.name })}</td>
              <td className="num">{s.annual ? money(s.annual) : <span className="sub">{tx(locale, "{n} of {m} lanes priced", { n: s.lanesPriced, m: s.lanes })}</span>}</td><td>1</td>
              <td>{canPick && <button type="button" className="btn ghost" onClick={() => onPickAll(s.supplierId!)}>{tx(locale, "Select for all lanes")}</button>}</td></tr>))}
          <tr><td><b>{tx(locale, "Award lane by lane (lowest price each)")}</b></td><td className="num"><b>{m.byLane.annual ? money(m.byLane.annual) : "-"}</b></td><td>{m.byLane.carriers}</td>
            <td>{canPick && <button type="button" className="btn ghost" onClick={onPickLowest}>{tx(locale, "Select lowest for each lane")}</button>}</td></tr>
        </tbody>
      </table></div>
      <div className="sub" role="note">{tx(locale, "These figures compare prices only. The recommendation below also weighs the technical score, and you can choose a different carrier for any lane.")}</div>
    </div>
  );
}
