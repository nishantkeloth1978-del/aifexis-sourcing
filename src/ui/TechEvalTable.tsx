"use client";
import { useMemo, useState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { EvalView } from "@/evaluation/service";

type ViewKey = "mine" | "avg" | "ai" | "gap";
const AV = ["#5b45f5", "#0891b2", "#e11d74", "#f97316", "#12a150", "#8b5cf6"];
const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const cls = (v: number) => (v >= 8 ? "s-hi" : v >= 5 ? "s-mid" : "s-lo");
const ASSESS: Record<string, string> = { meets: "Appears to meet", partly: "Partly addressed", does_not_meet: "Appears not to meet", no_evidence: "No evidence found" };

interface Row { supplierId: string; name: string; failed: string[]; gatesKnown: boolean; disqualified: string[]; hasBid: boolean }

/** The technical evaluation as one table: a row per bidder, a column per criterion, the weighted total against the pass mark, the mandatory gates and a tick to qualify. */
export default function TechEvalTable({ view, locale, scores, setScore, savedFor, why, setWhy, busy, onSave, picked, setPicked, canEdit }: {
  view: EvalView; locale: Locale; busy: boolean; canEdit: boolean;
  scores: Record<string, Record<string, string>>; setScore: (supplierId: string, criterion: string, v: string) => void;
  savedFor: Record<string, boolean>; why: Record<string, string>; setWhy: (supplierId: string, v: string) => void; onSave: (supplierId: string) => void;
  picked: Record<string, boolean>; setPicked: (supplierId: string, v: boolean) => void;
}) {
  const isEval = view.roles.includes("tech_evaluator");
  const hasMatrix = Boolean(view.matrix);
  const hasDrafts = Object.keys(view.drafts).length > 0;
  const views = ([["mine", "My scores", isEval], ["avg", "Average of evaluators", hasMatrix], ["ai", "AI draft", hasDrafts], ["gap", "Evaluator comparison", hasMatrix]] as [ViewKey, string, boolean][]).filter((x) => x[2]);
  const [v, setV] = useState<ViewKey>(views[0]?.[0] ?? "ai");
  const [sel, setSel] = useState<[string, string] | null>(null);
  const cur: ViewKey = views.some((x) => x[0] === v) ? v : (views[0]?.[0] ?? "ai");
  const W = view.criterionWeights;
  const crit = view.criteria;

  const rows: Row[] = useMemo(() => {
    const map = new Map<string, Row>();
    for (const b of view.bidders ?? []) map.set(b.supplierId, { supplierId: b.supplierId, name: b.name, failed: b.failed, gatesKnown: true, disqualified: [], hasBid: true });
    for (const r of view.results ?? []) { const e = map.get(r.supplierId); if (e) e.disqualified = r.disqualified ?? []; else map.set(r.supplierId, { supplierId: r.supplierId, name: r.name, failed: [], gatesKnown: false, disqualified: r.disqualified ?? [], hasBid: false }); }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [view.bidders, view.results]);

  const mineOf = (id: string): (number | null)[] => crit.map((k) => { const x = scores[id]?.[k]; const n = x === undefined || x === "" ? NaN : Number(x); return Number.isFinite(n) ? n : null; });
  const avgOf = (id: string): (number | null)[] => crit.map((k) => view.matrix?.[id]?.[k]?.avg ?? null);
  const aiOf = (id: string): (number | null)[] => crit.map((k) => view.drafts[id]?.find((d) => d.criterion === k)?.score ?? null);
  const valuesFor = (id: string, which: ViewKey) => (which === "mine" ? mineOf(id) : which === "ai" ? aiOf(id) : avgOf(id));
  const totalOf = (vals: (number | null)[]) => { if (vals.every((x) => x === null)) return null; const n = vals.map((x) => x ?? 0); return Math.round((W ? n.reduce((a, x, i) => a + x * (W[i] ?? 0), 0) / 10 : (n.reduce((a, b) => a + b, 0) / Math.max(1, n.length)) * 10) * 100) / 100; };
  const gapIds = new Set((view.gaps ?? []).map((g) => g.supplierId));
  const editable = canEdit && isEval && view.state === "technical_evaluation" && cur === "mine";
  const canTick = Boolean(view.results) && view.roles.includes("tech_approver") && view.state === "technical_evaluation";
  const pass = view.qualifyAt;
  const selRow = sel ? rows.find((r) => r.supplierId === sel[0]) : null;
  const selK = sel ? sel[1] : null;
  const selIdx = selK ? crit.indexOf(selK) : -1;
  const selDraft = sel ? view.drafts[sel[0]]?.find((d) => d.criterion === sel[1]) : undefined;
  const selCell = sel ? view.matrix?.[sel[0]]?.[sel[1]] : undefined;

  if (!rows.length) return null;
  return (
    <div role="region" aria-label={tx(locale, "Technical evaluation table")}>
      <div className="row" style={{ marginTop: 12 }}>
        {views.length > 1 ? <div className="seg" role="tablist">{views.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={cur === k} className={cur === k ? "on" : ""} onClick={() => setV(k)}>{tx(locale, label)}</button>)}</div> : <span />}
        <span className="sub">{tx(locale, "Click a score for the reason and the quoted evidence.")}</span>
      </div>
      <div className="evscroll"><table className="evtable">
        <thead><tr>
          {canTick && <th className="n">{tx(locale, "Qualifies")}</th>}
          <th>{tx(locale, "Bidder")}</th><th>{tx(locale, "Gates")}</th>
          {crit.map((k, i) => <th key={k} className="n">{k}{W && <small>{tx(locale, "weight {n}%", { n: W[i] ?? 0 })}</small>}</th>)}
          <th>{tx(locale, "Total")}</th><th>{tx(locale, "Result")}</th>
        </tr></thead>
        <tbody>{rows.map((r, ri) => {
          const out = r.failed.length > 0 || r.disqualified.length > 0;
          const vals = cur === "gap" ? avgOf(r.supplierId) : valuesFor(r.supplierId, cur);
          const total = totalOf(vals);
          const passed = !out && total !== null && total >= pass;
          return (
            <tr key={r.supplierId} className={out ? "out" : ""}>
              {canTick && <td className="n"><input className="check" type="checkbox" aria-label={tx(locale, "Qualifies")} disabled={out} checked={!!picked[r.supplierId] && !out} onChange={(e) => setPicked(r.supplierId, e.target.checked)} /></td>}
              <td><div className="who"><span className="av" style={{ background: AV[ri % AV.length] }} aria-hidden="true">{r.name.slice(0, 1).toUpperCase()}</span>{r.name}</div></td>
              <td>{!r.gatesKnown && !r.disqualified.length ? <span className="sub">-</span> : out ? <><span className="pill bad">{tx(locale, "Failed")}</span><div className="sub">{(r.failed.length ? r.failed : r.disqualified).map((f) => tx(locale, f)).join("; ")}</div></> : <span className="pill done">{tx(locale, "Passed")}</span>}</td>
              {crit.map((k, i) => {
                const mine = mineOf(r.supplierId)[i] ?? null, ai = aiOf(r.supplierId)[i] ?? null;
                if (cur === "gap") {
                  const cell = view.matrix?.[r.supplierId]?.[k];
                  const sc = cell?.by.map((b) => b.score) ?? [];
                  const spread = sc.length > 1 ? Math.max(...sc) - Math.min(...sc) : 0;
                  return <td key={k} className="n">{cell ? <button type="button" className={`score ${cls(cell.avg)}`} onClick={() => setSel([r.supplierId, k])}>{sc.join(" / ")}</button> : "-"}{spread >= 3 && <span className="ai"><b>{tx(locale, "gap {n}", { n: f1(spread) })}</b></span>}</td>;
                }
                if (editable) return (
                  <td key={k} className="n"><input className="cellin" inputMode="decimal" aria-label={`${r.name}: ${k}`} placeholder="0-10" value={scores[r.supplierId]?.[k] ?? ""} onChange={(e) => setScore(r.supplierId, k, e.target.value)} disabled={!r.hasBid} />
                    {ai !== null && <button type="button" className="ai linkish" onClick={() => setSel([r.supplierId, k])}>AI <b>{f1(ai)}</b></button>}</td>);
                const shown = cur === "mine" ? mine : cur === "ai" ? ai : (avgOf(r.supplierId)[i] ?? null);
                return <td key={k} className="n">{shown === null ? <span className="sub">-</span> : <button type="button" className={`score ${cls(shown)}`} onClick={() => setSel([r.supplierId, k])}>{f1(shown)}</button>}{cur !== "ai" && cur !== "mine" && ai !== null && <span className="ai">AI <b>{f1(ai)}</b></span>}</td>;
              })}
              <td style={{ minWidth: 140 }}>{total === null ? <span className="sub">-</span> : <><div className="total">{f1(total)} <span className="sub">/ 100</span></div>
                <div className={`evbar ${out ? "" : passed ? "pass" : "fail"}`}><i style={{ width: `${Math.min(100, total)}%` }} /><span className="mark" style={{ left: `${pass}%` }} /></div></>}</td>
              <td>
                {out ? <span className="pill bad">{tx(locale, "Disqualified")}</span> : total === null ? <span className="sub">-</span> : passed ? <span className="pill done">{tx(locale, "Qualifies")}</span> : <span className="pill warn">{tx(locale, "Below pass mark")}</span>}
                {gapIds.has(r.supplierId) && <div><span className="pill warn">{tx(locale, "Score gap to explain")}</span></div>}
                {editable && r.hasBid && <div className="evsave">
                  {view.myScores[r.supplierId] && <input className="cellin wide" value={why[r.supplierId] ?? ""} maxLength={1000} placeholder={tx(locale, "Reason for changing saved scores")} aria-label={tx(locale, "Reason for changing saved scores")} onChange={(e) => setWhy(r.supplierId, e.target.value)} />}
                  <button className="btn ghost" type="button" disabled={busy} onClick={() => onSave(r.supplierId)}>{savedFor[r.supplierId] ? tx(locale, "Saved") : tx(locale, "Save scores")}</button></div>}
              </td>
            </tr>);
        })}</tbody>
      </table></div>
      <div className="legend sub"><span className="score s-hi">8+</span> {tx(locale, "strong")} <span className="score s-mid">5-7</span> {tx(locale, "partial")} <span className="score s-lo">&lt;5</span> {tx(locale, "weak")} <span>{tx(locale, "The small figure under a score is the AI draft.")}</span></div>

      {sel && selRow && selIdx >= 0 && (
        <div className="evdetail" role="region" aria-label={tx(locale, "Score detail")}>
          <div className="row"><b>{selRow.name}: {selK}</b>{W && <span className="sub">{tx(locale, "weight {n}%", { n: W[selIdx] ?? 0 })}</span>}</div>
          {selCell && <div>{selCell.by.map((b) => <span key={b.evaluator} style={{ marginInlineEnd: 14 }}>{b.evaluator}: <b>{b.score}</b></span>)}</div>}
          {selDraft ? (
            <div style={{ marginTop: 6 }}><b>{tx(locale, "AI draft")}:</b> {selDraft.score} / 10, {tx(locale, ASSESS[selDraft.assessment] ?? "")}
              {selDraft.summary && <div>{selDraft.summary}</div>}{selDraft.quotes.map((q, i) => <blockquote key={i}>{q}</blockquote>)}</div>
          ) : <div className="sub" style={{ marginTop: 6 }}>{tx(locale, "There is no AI draft for this score.")}</div>}
          <div className="actions" style={{ marginTop: 8 }}>
            {editable && selDraft && <button className="btn ghost" type="button" onClick={() => setScore(selRow.supplierId, selK!, String(selDraft.score))}>{tx(locale, "Use the AI score for this cell")}</button>}
            <button className="btn ghost" type="button" onClick={() => setSel(null)}>{tx(locale, "Close")}</button>
          </div>
        </div>)}
    </div>
  );
}
