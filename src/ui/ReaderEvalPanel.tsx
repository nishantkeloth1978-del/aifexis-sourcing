"use client";
import { useState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { EvalResult } from "@/agents/readereval";
import { runReaderEvalAction } from "../../app/configuration/actions";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Scores the bid reader on ten labelled sample texts, so you can see how far to trust it before relying on it. */
export default function ReaderEvalPanel({ locale }: { locale: Locale }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [res, setRes] = useState<EvalResult | null>(null);
  async function run() {
    setBusy(true); setError(null);
    const r = await runReaderEvalAction().catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (r.ok) setRes(r.result); else setError(r.error);
  }
  return (
    <div className="card newform detail" style={{ maxWidth: 760 }}>
      <div className="row"><h3>{tx(locale, "Bid reader accuracy")}</h3></div>
      <div className="sub">{tx(locale, "Runs the bid reader on ten sample supplier texts where the right findings are known, using your Claude key, and shows how many it found and how many it invented. Nothing in your data is read or changed. It takes about half a minute.")}</div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      <div className="row"><button className="btn" type="button" disabled={busy} onClick={run}>{busy ? tx(locale, "Running…") : tx(locale, "Run the accuracy check")}</button></div>
      {res && (
        <div role="status" style={{ marginTop: 12 }}>
          <p><b>{tx(locale, "Found")}: {pct(res.recall)}</b> · <b>{tx(locale, "Correct when flagged")}: {pct(res.precision)}</b> · F1 {pct(res.f1)} · {res.model}</p>
          <table className="table"><thead><tr><th>{tx(locale, "Case")}</th><th>{tx(locale, "Found")}</th><th>{tx(locale, "Extra")}</th></tr></thead>
            <tbody>{res.cases.map((c) => <tr key={c.id}><td>{c.id}</td><td>{c.found} / {c.gold}{c.failed ? ` · ${tx(locale, "call failed")}` : ""}</td><td>{c.extra}</td></tr>)}</tbody></table>
        </div>)}
    </div>
  );
}
