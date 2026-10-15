"use client";
import { useState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { ImportResult } from "@/requests/import";
import { importRequestsAction } from "../../app/requests/actions";

/** Pick a CSV file (or paste its text); every request in it is checked by the same rules as the form, and the result is reported request by request. */
export default function RequestImport({ locale }: { locale: Locale }) {
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [result, setResult] = useState<ImportResult | null>(null);
  async function pick(f: File | undefined) { if (!f) return; setError(null); setResult(null); setText(await f.text()); }
  async function run(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setResult(null);
    const r = await importRequestsAction(text).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (r.ok) setResult(r); else setError(r.error);
  }
  return (
    <form className="card newform detail" onSubmit={run} style={{ maxWidth: 760 }}>
      <div className="sub">{tx(locale, "One row per line. Rows with the same external reference form one request. Download the template to see the columns.")}</div>
      <p><a href="/api/export/request-template">{tx(locale, "Download the template")}</a></p>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      <label>{tx(locale, "CSV file")}<input type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0])} /></label>
      <label>{tx(locale, "Or paste the rows")}<textarea rows={6} value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} maxLength={200000} /></label>
      <div className="row"><button className="btn" disabled={busy || !text.trim()}>{busy ? tx(locale, "Importing…") : tx(locale, "Import requests")}</button></div>
      {result && (
        <div role="status">
          <p>{tx(locale, "Created")}: {result.created} · {tx(locale, "Skipped")}: {result.skipped} · {tx(locale, "Failed")}: {result.failed}</p>
          <table className="table"><thead><tr><th>{tx(locale, "Row")}</th><th>{tx(locale, "Title")}</th><th>{tx(locale, "Result")}</th></tr></thead>
            <tbody>{result.rows.map((r) => <tr key={r.firstRow}><td>{r.firstRow}</td><td>{r.title}</td><td>{r.reference ?? ""}{r.error ? ` ${tx(locale, r.error)}` : ""}</td></tr>)}</tbody></table>
        </div>)}
    </form>
  );
}
