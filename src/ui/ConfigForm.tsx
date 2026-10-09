"use client";
import HelpTip from "./HelpTip";
import { useState } from "react";
import type { EvalConfig } from "@/config/service";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { saveConfigAction } from "../../app/configuration/actions";

export default function ConfigForm({ initial, version, canEdit, locale = "en" }: { initial: EvalConfig; version: number; canEdit: boolean; locale?: Locale }) {
  const [criteria, setCriteria] = useState<string[]>(initial.criteria);
  const [cw, setCw] = useState<string[]>(() => initial.criterionWeights ? initial.criterionWeights.map(String) : initial.criteria.map(() => ""));
  const [useW, setUseW] = useState(Boolean(initial.criterionWeights));
  const [ko, setKo] = useState<string[]>(initial.knockout ?? []);
  const [thr, setThr] = useState(initial.approval?.publicationThreshold != null ? String(initial.approval.publicationThreshold) : "");
  const [tiers, setTiers] = useState<{ min: string; n: string }[]>((initial.approval?.awardTiers ?? []).map((t) => ({ min: String(t.minValue), n: String(t.approvals) })));
  const [gates, setGates] = useState<string[]>(initial.gates ?? []);
  const [tech, setTech] = useState(String(initial.weights.technical));
  const [qualifyAt, setQualifyAt] = useState(String(initial.qualifyAt));
  const [margin, setMargin] = useState(String(initial.closeMargin));
  const [decl, setDecl] = useState(initial.evaluatorDeclarations === true);
  const [anon, setAnon] = useState(initial.anonymousEvaluation === true);
  const [gap, setGap] = useState(String(initial.moderationGap ?? 20));
  const [chg, setChg] = useState(initial.scoreChangeApproval === "second_person");
  const [ver, setVer] = useState(version);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const t = Number(tech);
  const comm = Number.isFinite(t) ? 100 - t : NaN;
  const dis = !canEdit;

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null); setState("saving");
    const res = await saveConfigAction({ criteria, weights: { technical: t, commercial: comm }, qualifyAt: Number(qualifyAt), closeMargin: Number(margin), gates, evaluatorDeclarations: decl, anonymousEvaluation: anon, moderationGap: Number(gap), scoreChangeApproval: chg ? "second_person" : "none", approval: { ...(thr.trim() !== "" ? { publicationThreshold: Number(thr.replace(/,/g, "")) } : {}), ...(tiers.length ? { awardTiers: tiers.map((t) => ({ minValue: Number(t.min.replace(/,/g, "")), approvals: Number(t.n) })) } : {}) }, ...(useW ? { criterionWeights: criteria.map((_, i) => Number(cw[i] ?? 0)) } : {}), knockout: ko.filter((k) => gates.map((g) => g.trim()).includes(k.trim())) })
      .catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    if (!res.ok) { setState("idle"); setError(res.error); return; }
    setVer(res.version); setState("saved");
  }
  const touch = () => setState("idle");

  return (
    <form className="card newform detail" onSubmit={save} style={{ maxWidth: 720 }}>
      <div className="row"><h3>{tx(locale, "Evaluation settings")}</h3><span className="sub">{ver ? tx(locale, "Version {n}", { n: ver }) : tx(locale, "Defaults")}</span></div>
      <div className="sub">{tx(locale, "Applies to events published from now on. Events already published keep the settings they were published with.")}{!canEdit && ` ${tx(locale, "Only an administrator can change these.")}`}</div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}

      <b>{tx(locale, "Technical criteria")} <span className="sub">{tx(locale, "(each scored 0 to 10)")}</span></b>
      {criteria.map((c, i) => (
        <div key={i} className="actions" style={{ marginTop: 0 }}>
          <input style={{ flex: 1 }} value={c} disabled={dis} maxLength={80} aria-label={tx(locale, "Criterion {n}", { n: i + 1 })} onChange={(e) => { touch(); setCriteria((l) => l.map((x, j) => (j === i ? e.target.value : x))); }} />
          {useW && <input style={{ width: 70 }} inputMode="numeric" value={cw[i] ?? ""} disabled={dis} aria-label={tx(locale, "Weight of criterion {n} (%)", { n: i + 1 })} placeholder="%" onChange={(e) => { touch(); setCw((l) => { const n = [...l]; n[i] = e.target.value; return n; }); }} />}
          {canEdit && <button type="button" className="btn ghost" disabled={criteria.length <= 1} onClick={() => { touch(); setCriteria((l) => l.filter((_, j) => j !== i)); setCw((l) => l.filter((_, j) => j !== i)); }}>{tx(locale, "Remove")}</button>}
        </div>
      ))}
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={useW} disabled={dis} onChange={(e) => { touch(); setUseW(e.target.checked); if (e.target.checked && cw.every((x) => !x)) { const n = criteria.length; setCw(criteria.map((_, i) => String(Math.floor(100 / n) + (i < 100 % n ? 1 : 0)))); } }} />{tx(locale, "Weight criteria differently")} <span className="sub">{tx(locale, "(percentages must add up to 100: now {n})", { n: useW ? cw.slice(0, criteria.length).reduce((a, b) => a + (Number(b) || 0), 0) : 100 })}</span></label>
      {canEdit && criteria.length < 8 && <div className="actions" style={{ marginTop: 0 }}><button type="button" className="btn ghost" onClick={() => { touch(); setCriteria((l) => [...l, ""]); setCw((l) => [...l, ""]); }}>{tx(locale, "Add criterion")}</button></div>}

      <b>{tx(locale, "Mandatory declarations")} <span className="sub">{tx(locale, "(every bidder must answer Yes or No before submitting)")}</span></b>
      {gates.map((g, i) => (
        <div key={i} className="actions" style={{ marginTop: 0 }}>
          <input style={{ flex: 1 }} value={g} disabled={dis} maxLength={120} placeholder={tx(locale, "e.g. We hold a valid trade licence")} aria-label={tx(locale, "Declaration {n}", { n: i + 1 })} onChange={(e) => { touch(); setGates((l) => l.map((x, j) => (j === i ? e.target.value : x))); }} />
          <label className="sub" style={{ display: "flex", gap: 4, alignItems: "center", whiteSpace: "nowrap" }}><input type="checkbox" disabled={dis || !g.trim()} checked={ko.includes(g.trim())} onChange={(e) => { touch(); setKo((l) => e.target.checked ? [...l, g.trim()] : l.filter((x) => x !== g.trim())); }} />{tx(locale, "No disqualifies")}</label>
          {canEdit && <button type="button" className="btn ghost" onClick={() => { touch(); setGates((l) => l.filter((_, j) => j !== i)); }}>{tx(locale, "Remove")}</button>}
        </div>
      ))}
      {canEdit && gates.length < 8 && <div className="actions" style={{ marginTop: 0 }}><button type="button" className="btn ghost" onClick={() => { touch(); setGates((l) => [...l, ""]); }}>{tx(locale, "Add declaration")}</button></div>}

      <div className="two">
        <label>{tx(locale, "Technical weight (%)")}<input inputMode="numeric" value={tech} disabled={dis} onChange={(e) => { touch(); setTech(e.target.value); }} /></label>
        <label>{tx(locale, "Commercial weight (%)")}<input value={Number.isFinite(comm) ? comm : ""} disabled /></label>
      </div>
      <div className="two">
        <h4>{tx(locale, "Evaluator controls")}</h4>
        <label className="check"><input type="checkbox" checked={decl} disabled={dis} onChange={(e) => { touch(); setDecl(e.target.checked); }} /> {tx(locale, "Evaluators must declare any conflict of interest before reading bids")}</label>
        <label className="check"><input type="checkbox" checked={anon} disabled={dis} onChange={(e) => { touch(); setAnon(e.target.checked); }} /> {tx(locale, "Hide bidder names from evaluators until the technical result is approved")} <HelpTip locale={locale} text="Evaluators see Bidder A, Bidder B and so on while scoring, so names cannot influence scores. Buyers still see real names." /></label>
        <label>{tx(locale, "Score difference between evaluators to explain (points out of 100, 0 turns it off)")}<input inputMode="numeric" value={gap} disabled={dis} onChange={(e) => { touch(); setGap(e.target.value); }} /></label>
        <label className="check"><input type="checkbox" checked={chg} disabled={dis} onChange={(e) => { touch(); setChg(e.target.checked); }} /> {tx(locale, "A material change to a saved score needs another person's approval")}</label>
        <label>{tx(locale, "Suggested technical pass mark (out of 100)")}<input inputMode="numeric" value={qualifyAt} disabled={dis} onChange={(e) => { touch(); setQualifyAt(e.target.value); }} /></label>
        <label>{tx(locale, "Close-result warning below (points)")}<input inputMode="decimal" value={margin} disabled={dis} onChange={(e) => { touch(); setMargin(e.target.value); }} /></label>
      </div>
      <b>{tx(locale, "Approval rules")} <span className="sub">{tx(locale, "(by the event's estimated value, in AED)")}</span></b>
      <label>{tx(locale, "Publish without a separate approver below (AED)")}<input inputMode="numeric" value={thr} disabled={dis} placeholder={tx(locale, "Empty: every event needs an approver")} onChange={(e) => { touch(); setThr(e.target.value); }} /></label>
      <div className="sub">{tx(locale, "Award approvals needed from this value upwards. Without a rule, one approval is needed.")}</div>
      {tiers.map((t, i) => (
        <div key={i} className="actions" style={{ marginTop: 0 }}>
          <input style={{ flex: 1 }} inputMode="numeric" value={t.min} disabled={dis} placeholder={tx(locale, "From value (AED)")} aria-label={tx(locale, "Tier {n} from value", { n: i + 1 })} onChange={(e) => { touch(); setTiers((l) => l.map((x, j) => (j === i ? { ...x, min: e.target.value } : x))); }} />
          <select value={t.n} disabled={dis} aria-label={tx(locale, "Tier {n} approvals", { n: i + 1 })} onChange={(e) => { touch(); setTiers((l) => l.map((x, j) => (j === i ? { ...x, n: e.target.value } : x))); }}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 1 ? tx(locale, "1 approval") : tx(locale, "{n} approvals", { n })}</option>)}</select>
          {canEdit && <button type="button" className="btn ghost" onClick={() => { touch(); setTiers((l) => l.filter((_, j) => j !== i)); }}>{tx(locale, "Remove")}</button>}
        </div>
      ))}
      {canEdit && tiers.length < 5 && <div className="actions" style={{ marginTop: 0 }}><button type="button" className="btn ghost" onClick={() => { touch(); setTiers((l) => [...l, { min: "", n: "2" }]); }}>{tx(locale, "Add tier")}</button></div>}
      {canEdit && <div className="actions"><button className="btn" type="submit" disabled={state === "saving" || state === "saved"}>{state === "saving" ? tx(locale, "Saving...") : state === "saved" ? tx(locale, "Saved") : tx(locale, "Save settings")}</button></div>}
    </form>
  );
}
