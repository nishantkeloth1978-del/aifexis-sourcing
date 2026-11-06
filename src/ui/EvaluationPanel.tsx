"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import DecisionGate from "./DecisionGate";
import type { EvalView } from "@/evaluation/service";
import type { Finding } from "@/evaluation/assist";
import { suggestFindingsAction, approveScoreChangeAction, approveTechnicalAction, closeBiddingAction, declareConflictAction, openAllEnvelopesAction, openEnvelopesAction, recordModerationAction, runAgentAction, saveScoresAction, setAiTechEvalAction } from "../../app/events/[id]/actions";

export default function EvaluationPanel({ eventId, view, locale = "en" }: { eventId: string; view: EvalView; locale?: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [witness, setWitness] = useState(view.witnesses[0]?.membershipId ?? "");
  const [scores, setScores] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(Object.entries(view.myScores).map(([s, m]) => [s, Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)]))])));
  const [savedFor, setSavedFor] = useState<Record<string, boolean>>(() => Object.fromEntries(Object.keys(view.myScores).map((s) => [s, true])));
  const [picked, setPicked] = useState<Record<string, boolean>>(() => Object.fromEntries((view.results ?? []).map((r) => [r.supplierId, r.suggested])));

  const has = (r: string) => view.roles.includes(r);
  const canClose = view.state === "published" && has("buyer");
  const deadlineReached = view.closesAt ? new Date(view.closesAt).getTime() <= Date.now() : false;
  const isEvaluator = has("tech_evaluator");
  const [detail, setDetail] = useState("");
  const [ai, setAi] = useState<Record<string, { findings?: Finding[]; note?: string; error?: string; busy?: boolean }>>({});
  async function suggest(supplierId: string) {
    setAi((a) => ({ ...a, [supplierId]: { busy: true } }));
    const r = await suggestFindingsAction(eventId, supplierId).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setAi((a) => ({ ...a, [supplierId]: r.ok ? { findings: r.findings, note: r.note } : { error: r.error } }));
  }
  const ASSESS_LABEL: Record<Finding["assessment"], string> = { meets: "Appears to meet", partly: "Partly addressed", does_not_meet: "Appears not to meet", no_evidence: "No evidence found" };
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const [agentBusy, setAgentBusy] = useState<string | null>(null);
  const [agentMsg, setAgentMsg] = useState<string | null>(null);
  async function runAgent(supplierId?: string) {
    setAgentMsg(null); setAgentBusy(supplierId ?? "all");
    const r = await runAgentAction(eventId, supplierId).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setAgentBusy(null);
    if (!r.ok) { setAgentMsg(tx(locale, r.error)); return; }
    const bad = r.runs.filter((x) => !x.ok).length;
    setAgentMsg(bad ? tx(locale, "The agent could not finish {n} bidder(s). Try again for those.", { n: bad }) : tx(locale, "The agent has drafted scores. Review them below, then use and save them."));
    router.refresh();
  }
  function useDraft(supplierId: string) {
    const d = view.drafts[supplierId]; if (!d) return;
    setSavedFor((x) => ({ ...x, [supplierId]: false }));
    setScores((x) => ({ ...x, [supplierId]: Object.fromEntries(d.map((r) => [r.criterion, String(r.score)])) }));
  }
  const draftTotal = (supplierId: string) => { const d = view.drafts[supplierId]; if (!d) return null; const by = new Map(d.map((r) => [r.criterion, r.score])); const v = view.criteria.map((k) => by.get(k) ?? 0); const w = view.criterionWeights; return Math.round((w ? v.reduce((a, x, i) => a + x * (w[i] ?? 0), 0) / 10 : (v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)) * 10) * 100) / 100; };
  const needsDeclaration = view.declarationsRequired && isEvaluator && view.declaration === "none";
  const recused = view.declarationsRequired && isEvaluator && view.declaration === "conflict";

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null); setBusy(true);
    const res = await fn().catch(() => ({ ok: false, error: tx(locale, "That could not be saved. Try again.") }));
    setBusy(false);
    if (!res.ok) { setError(("error" in res && res.error) || tx(locale, "That is not allowed.")); return false; }
    router.refresh(); return true;
  }
  async function saveOne(supplierId: string) {
    const raw = scores[supplierId] ?? {};
    const parsed: Record<string, number> = {};
    for (const k of view.criteria) parsed[k] = raw[k] === undefined || raw[k] === "" ? NaN : Number(raw[k]);
    setSavedFor((s) => ({ ...s, [supplierId]: true }));      // shown as saved at once
    const ok = await run(() => saveScoresAction(eventId, supplierId, parsed, why[supplierId]));
    if (!ok) setSavedFor((s) => ({ ...s, [supplierId]: false }));
  }

  if (view.state === "draft" || view.state === "pending_publication") return null;
  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Bids and evaluation")}</h3>{view.bidderCount !== null && <span className="sub">{view.bidderCount === 1 ? tx(locale, "1 bidder") : tx(locale, "{n} bidders", { n: view.bidderCount })}</span>}</div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}

      {view.agent.available && (view.agent.canRun || view.agent.canSwitch) && (
        <div className="bidcard agentbar" role="group" aria-label={tx(locale, "AI technical evaluation")}>
          <div className="row"><b>{tx(locale, "AI technical evaluation")}</b><span className="sub">{view.agent.auto ? tx(locale, "Runs by itself when the technical envelopes are opened.") : tx(locale, "Runs only when you click Evaluate.")}{view.agent.ranAt ? ` ${tx(locale, "Last run: {t}", { t: new Date(view.agent.ranAt).toLocaleString(locale === "ar" ? "ar" : "en-GB") })}` : ""}</span></div>
          <div className="sub">{tx(locale, "The agent drafts a score and quoted evidence for every bidder and criterion. It never approves anything: an evaluator reviews the draft and saves it as their own scores.")}</div>
          <div className="actions">
            {view.agent.canRun && <button className="btn" type="button" disabled={agentBusy !== null} onClick={() => runAgent()}>{agentBusy === "all" ? tx(locale, "Evaluating...") : Object.keys(view.drafts).length ? tx(locale, "Evaluate again with AI") : tx(locale, "Evaluate all bidders with AI")}</button>}
            {isEvaluator && Object.keys(view.drafts).length > 0 && view.state === "technical_evaluation" && <button className="btn ghost" type="button" onClick={() => Object.keys(view.drafts).forEach(useDraft)}>{tx(locale, "Use AI scores for all bidders")}</button>}
            {view.agent.canSwitch && <label>{tx(locale, "Automatic run for this event")}{" "}<select value={view.agent.override === null ? "default" : view.agent.override ? "on" : "off"} disabled={busy}
              onChange={(e) => run(() => setAiTechEvalAction(eventId, e.target.value === "default" ? null : e.target.value === "on"))}>
              <option value="default">{tx(locale, "Company default")}</option><option value="on">{tx(locale, "On")}</option><option value="off">{tx(locale, "Off")}</option></select></label>}
          </div>
          {agentMsg && <div className="sub" role="status">{agentMsg}</div>}
        </div>)}

      {view.state === "published" && (
        <div className="sub">{tx(locale, "Bids are sealed until the event is closed and the envelopes are opened.")}
          {canClose && <div className="actions"><button className="btn" type="button" disabled={busy}
            onClick={() => { if (deadlineReached || window.confirm(tx(locale, "The closing time has not been reached yet. Close bidding now? Suppliers will no longer be able to bid."))) run(() => closeBiddingAction(eventId, view.stateVersion)); }}>{busy ? tx(locale, "Closing...") : tx(locale, "Close bidding")}</button></div>}
        </div>
      )}

      {view.state === "closed" && (() => {
        const single = view.opening.envelopes === "single";
        const witnessed = view.opening.mode === "witnessed";
        const cmd = single ? "OpenEnvelopesTogether" : "OpenEnvelope1";
        const label = single ? tx(locale, "Open all envelopes") : tx(locale, "Open technical envelopes");
        const go = (w: string) => (single ? openAllEnvelopesAction(eventId, view.stateVersion, w) : openEnvelopesAction(eventId, view.stateVersion, w));
        return (
          <div>
            <div className="sub">{witnessed ? (single ? tx(locale, "Bidding is closed. Opening all envelopes needs a witness who is on this event.") : tx(locale, "Bidding is closed. Opening the technical envelopes needs a witness who is on this event."))
              : view.opening.mode === "buyer" ? (single ? tx(locale, "Bidding is closed. The buyer can open all envelopes. The audit log records who did it.") : tx(locale, "Bidding is closed. The buyer can open the technical envelopes. The audit log records who did it."))
              : tx(locale, "Bidding is closed. Envelopes open automatically. If they have not opened, there may be no bids yet.")}</div>
            {witnessed && has("buyer") && (view.witnesses.length === 0 ? <div className="sub">{tx(locale, "No witness is assigned to this event.")}</div> : (
              <div className="actions">
                <select value={witness} onChange={(e) => setWitness(e.target.value)} aria-label={tx(locale, "Witness")}>{view.witnesses.map((w) => <option key={w.membershipId} value={w.membershipId}>{w.email}</option>)}</select>
              </div>))}
            {witnessed && has("buyer") && view.witnesses.length > 0 && <DecisionGate locale={locale} eventId={eventId} version={view.stateVersion} command={cmd} secondId={witness} secondEmail={view.witnesses.find((w) => w.membershipId === witness)?.email ?? ""}
              payload={{ witnessMembershipId: witness }} request={view.decision} disabled={busy} runLabel={label} busyLabel={tx(locale, "Opening...")}
              onRun={() => go(witness)} />}
            {!witnessed && has("buyer") && <div className="actions"><button className="btn" type="button" disabled={busy} onClick={() => run(() => go(""))}>{busy ? tx(locale, "Opening...") : label}</button></div>}
          </div>
        );
      })()}

      {view.state === "technical_evaluation" && (
        <>
          {needsDeclaration && (
            <div className="bidcard" role="group" aria-label={tx(locale, "Conflict of interest declaration")}>
              <b>{tx(locale, "Conflict of interest declaration")}</b>
              <div className="sub">{tx(locale, "Before you read any bid, declare whether you have a conflict of interest in this event. You cannot change this later.")}</div>
              <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} maxLength={1000} placeholder={tx(locale, "If you have a conflict, describe it")} aria-label={tx(locale, "Describe the conflict")} />
              <div className="actions">
                <button className="btn" type="button" disabled={busy} onClick={() => run(() => declareConflictAction(eventId, false, ""))}>{tx(locale, "I have no conflict of interest")}</button>
                <button className="btn ghost" type="button" disabled={busy} onClick={() => run(() => declareConflictAction(eventId, true, detail))}>{tx(locale, "I have a conflict: recuse me")}</button>
              </div>
            </div>)}
          {recused && <div className="alert" role="status">{tx(locale, "You declared a conflict of interest, so you cannot read or score the bids of this event.")}</div>}
          {!view.bidders ? (needsDeclaration || recused ? null : <div className="sub">{tx(locale, "Technical envelopes are open. You do not have access to the technical responses.")}</div>) : view.bidders.map((b) => (
            <div key={b.supplierId} className="bidcard">
              <div className="row"><b>{b.name}</b><span className="sub">{tx(locale, "Revision {n}", { n: b.revisionNo })}</span></div>
              {b.failed.length > 0 && <div className="alert" role="alert">{tx(locale, "Disqualified: {reasons}", { reasons: b.failed.map((f) => tx(locale, f)).join("; ") })}</div>}
              {b.gates.length > 0 && <div className="sub">{b.gates.map((g) => <div key={g.name} style={{ color: g.answer ? undefined : "#b42318", fontWeight: g.answer ? undefined : 600 }}>{g.answer ? tx(locale, "Yes") : tx(locale, "No")}: {g.name}</div>)}</div>}
              <div className="bidtext">{b.technicalText}</div>
              {isEvaluator && view.aiAssist && (
                <div className="aiassist">
                  <button className="btn ghost" type="button" disabled={ai[b.supplierId]?.busy} onClick={() => suggest(b.supplierId)}>{ai[b.supplierId]?.busy ? tx(locale, "Reading the response...") : tx(locale, "Suggest findings with AI")}</button>
                  {ai[b.supplierId]?.error && <div className="alert" role="alert">{tx(locale, ai[b.supplierId]!.error!)}</div>}
                  {ai[b.supplierId]?.findings && (
                    <div role="region" aria-label={tx(locale, "AI suggested findings")}>
                      <div className="sub">{tx(locale, "AI suggestions only. Check each quote in the response and score it yourself.")}</div>
                      {ai[b.supplierId]!.findings!.map((f) => (
                        <div key={f.criterion} className="aifinding">
                          <b>{f.criterion}</b>: {tx(locale, ASSESS_LABEL[f.assessment])}
                          {f.summary && <div>{f.summary}</div>}
                          {f.quotes.map((q, i) => <blockquote key={i}>{q}</blockquote>)}
                          {f.droppedQuotes > 0 && <div className="sub">{tx(locale, "{n} quoted passage(s) could not be found in the response and were removed.", { n: f.droppedQuotes })}</div>}
                        </div>))}
                    </div>)}
                </div>)}
              {view.drafts[b.supplierId] && (
                <div className="aiassist" role="region" aria-label={tx(locale, "AI draft scores")}>
                  <div className="row"><b>{tx(locale, "AI draft scores")}</b><span className="sub">{tx(locale, "Draft total: {n} of 100", { n: draftTotal(b.supplierId) ?? 0 })}</span></div>
                  {view.drafts[b.supplierId]!.map((f) => (
                    <div key={f.criterion} className="aifinding">
                      <b>{f.criterion}</b>: {f.score} / 10, {tx(locale, ASSESS_LABEL[f.assessment])}
                      {f.summary && <div>{f.summary}</div>}
                      {f.quotes.map((q, i) => <blockquote key={i}>{q}</blockquote>)}
                    </div>))}
                  <div className="actions">
                    {isEvaluator && view.state === "technical_evaluation" && <button className="btn ghost" type="button" onClick={() => useDraft(b.supplierId)}>{tx(locale, "Use these scores")}</button>}
                    {view.agent.canRun && <button className="btn ghost" type="button" disabled={agentBusy !== null} onClick={() => runAgent(b.supplierId)}>{agentBusy === b.supplierId ? tx(locale, "Evaluating...") : tx(locale, "Evaluate this bidder again")}</button>}
                  </div>
                </div>)}
              {isEvaluator && (
                <div className="scoregrid">
                  {view.criteria.map((k, i) => (
                    <label key={k}>{k}{view.criterionWeights ? ` (${view.criterionWeights[i]}%)` : ""}<input inputMode="decimal" placeholder={tx(locale, "0 to 10")} value={scores[b.supplierId]?.[k] ?? ""}
                      onChange={(e) => { setSavedFor((s) => ({ ...s, [b.supplierId]: false })); setScores((s) => ({ ...s, [b.supplierId]: { ...s[b.supplierId], [k]: e.target.value } })); }} /></label>
                  ))}
                  {view.myScores[b.supplierId] && <label>{tx(locale, "Reason for changing saved scores")}<input value={why[b.supplierId] ?? ""} maxLength={1000} onChange={(e) => setWhy((w) => ({ ...w, [b.supplierId]: e.target.value }))} /></label>}
                  <button className="btn ghost" type="button" disabled={busy} onClick={() => saveOne(b.supplierId)}>{savedFor[b.supplierId] ? tx(locale, "Saved") : tx(locale, "Save scores")}</button>
                </div>
              )}
            </div>
          ))}
          {view.gaps && view.gaps.length > 0 && (
            <div className="bidcard" role="group" aria-label={tx(locale, "Score differences to explain")}>
              <b>{tx(locale, "Score differences to explain")}</b>
              <div className="sub">{tx(locale, "Evaluators differ by more than the allowed gap on these criteria. Record why before approving.")}</div>
              {view.gaps.map((g) => { const key = `${g.supplierId}|${g.criterion}`; return (
                <div key={key} className="scoregrid">
                  <span><b>{g.supplierName}</b>: {g.criterion}, {g.min} to {g.max} ({tx(locale, "{n} points apart", { n: g.gap })})</span>
                  {g.reason && <span className="sub">{tx(locale, "Reason")}: {g.reason}</span>}
                  {view.canModerate && <><input value={reasons[key] ?? ""} maxLength={1000} placeholder={tx(locale, "Reason")} aria-label={tx(locale, "Reason")} onChange={(e) => setReasons((r) => ({ ...r, [key]: e.target.value }))} />
                    <button className="btn ghost" type="button" disabled={busy} onClick={() => run(() => recordModerationAction(eventId, g.supplierId, g.criterion, reasons[key] ?? ""))}>{tx(locale, "Record reason")}</button></>}
                </div>); })}
            </div>)}
          {view.pendingChanges && view.pendingChanges.length > 0 && (
            <div className="bidcard" role="group" aria-label={tx(locale, "Score changes waiting for approval")}>
              <b>{tx(locale, "Score changes waiting for approval")}</b>
              {view.pendingChanges.map((p) => (
                <div key={p.id} className="scoregrid">
                  <span><b>{p.supplierName}</b>: {p.criterion}, {p.oldScore} to {p.newScore} ({p.evaluator}). {tx(locale, "Reason")}: {p.reason}</span>
                  {view.canModerate && !p.mine && <button className="btn ghost" type="button" disabled={busy} onClick={() => run(() => approveScoreChangeAction(eventId, p.id))}>{tx(locale, "Approve change")}</button>}
                </div>))}
            </div>)}
          {view.results && (
            <div>
              <h3>{tx(locale, "Technical result")}</h3>
              <div className="sub">{tx(locale, "Out of 100. Tick the bidders that qualify (suggested: {q} or more).", { q: view.qualifyAt })}</div>
              <div className="tablewrap"><table className="items"><thead><tr><th>{tx(locale, "Qualifies")}</th><th>{tx(locale, "Supplier")}</th><th className="num">{tx(locale, "Score")}</th><th className="num">{tx(locale, "Evaluators")}</th></tr></thead><tbody>
                {view.results.map((r) => (
                  <tr key={r.supplierId}><td><input type="checkbox" disabled={!!r.disqualified} checked={!!picked[r.supplierId] && !r.disqualified} onChange={(e) => setPicked((p) => ({ ...p, [r.supplierId]: e.target.checked }))} /></td>
                    <td>{r.name}{r.disqualified && <span className="pill" style={{ marginLeft: 8, color: "#b42318" }}>{tx(locale, "Disqualified")}</span>}</td><td className="num">{r.total ?? "-"}</td><td className="num">{r.evaluators}</td></tr>
                ))}
              </tbody></table></div>
              {has("tech_approver") && <div className="actions"><button className="btn" type="button" disabled={busy}
                onClick={() => run(() => approveTechnicalAction(eventId, view.stateVersion, Object.keys(picked).filter((k) => picked[k] && !view.results?.find((r) => r.supplierId === k)?.disqualified)))}>{busy ? tx(locale, "Approving...") : tx(locale, "Approve technical result")}</button></div>}
            </div>
          )}
        </>
      )}

      {["technical_approved", "commercial_evaluation", "recommended", "pending_award", "awarded"].includes(view.state) && view.results && (
        <div>
          <h3>{tx(locale, "Technical result")}</h3>
          <div className="tablewrap"><table className="items"><thead><tr><th>{tx(locale, "Supplier")}</th><th className="num">{tx(locale, "Score")}</th><th>{tx(locale, "Result")}</th></tr></thead><tbody>
            {view.results.map((r) => <tr key={r.supplierId}><td>{r.name}</td><td className="num">{r.total}</td><td>{r.qualified ? tx(locale, "Qualified") : tx(locale, "Not qualified")}</td></tr>)}
          </tbody></table></div>
        </div>
      )}
    </div>
  );
}
