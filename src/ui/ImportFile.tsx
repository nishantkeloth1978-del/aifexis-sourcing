"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";

type Preview<T> = { rows: T[]; errors: { row: number; message: string }[]; total: number };
type Done = { ok: true; message: string; notes?: string[] } | { ok: false; error: string };

/** Pick a spreadsheet, see what will be imported, confirm. Used for suppliers and the item catalogue. */
export default function ImportFile<T>({ locale = "en", label, templateHref, columns, preview: previewAction, run, importText }: {
  locale?: Locale; label: string; templateHref: string; importText: string;
  columns: { head: string; get: (r: T) => string }[];
  preview: (fd: FormData) => Promise<({ ok: true } & Preview<T>) | { ok: false; error: string }>;
  run: (rows: T[]) => Promise<Done>;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pv, setPv] = useState<Preview<T> | null>(null);
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; notes: string[] } | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setError(null); setPv(null); setDone(null); setBusy("read");
    const fd = new FormData(); fd.set("file", f);
    const r = await previewAction(fd).catch(() => ({ ok: false as const, error: "That file could not be read." }));
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setPv({ rows: r.rows, errors: r.errors, total: r.total });
  }
  async function confirm() {
    if (!pv) return;
    setError(null); setBusy("save");
    const r = await run(pv.rows).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setPv(null); setDone({ message: r.message, notes: r.notes ?? [] }); router.refresh();
  }
  const bad = pv?.errors.length ?? 0;
  return (
    <div className="importbox">
      <div className="actions" style={{ marginTop: 0 }}>
        <input ref={input} type="file" hidden accept=".xlsx,.csv" onChange={pick} />
        <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => input.current?.click()}>{busy === "read" ? tx(locale, "Reading...") : tx(locale, label)}</button>
        <a className="sublink" href={templateHref}>{tx(locale, "Download template")}</a>
      </div>
      {error && <div className="alert" role="alert" style={{ marginTop: 10 }}>{tx(locale, error)}</div>}
      {done && <div className="okbox" style={{ marginTop: 10 }}>{tx(locale, done.message)}{done.notes.length > 0 && <ul className="errlist">{done.notes.slice(0, 8).map((n, i) => <li key={i}>{tx(locale, n)}</li>)}</ul>}</div>}
      {pv && (
        <div style={{ marginTop: 10 }}>
          <div>{tx(locale, "{n} of {total} lines are ready to import.", { n: pv.rows.length, total: pv.total })}{bad > 0 && <> {bad === 1 ? tx(locale, "1 has a problem and will be skipped.") : tx(locale, "{n} have problems and will be skipped.", { n: bad })}</>}</div>
          {bad > 0 && <ul className="errlist">{pv.errors.slice(0, 8).map((e, i) => <li key={i}>{tx(locale, "Row {n}:", { n: e.row })} {tx(locale, e.message)}</li>)}{bad > 8 && <li>{tx(locale, "and {n} more", { n: bad - 8 })}</li>}</ul>}
          {pv.rows.length > 0 && (
            <div className="tablewrap"><table className="items"><thead><tr>{columns.map((c) => <th key={c.head}>{tx(locale, c.head)}</th>)}</tr></thead><tbody>
              {pv.rows.slice(0, 6).map((r, i) => <tr key={i}>{columns.map((c) => <td key={c.head}>{c.get(r)}</td>)}</tr>)}
              {pv.rows.length > 6 && <tr><td colSpan={columns.length} className="sub">{tx(locale, "and {n} more", { n: pv.rows.length - 6 })}</td></tr>}
            </tbody></table></div>)}
          <div className="actions">
            <button type="button" className="btn" disabled={busy !== null || pv.rows.length === 0} onClick={confirm}>{busy === "save" ? tx(locale, "Importing...") : tx(locale, importText, { n: pv.rows.length })}</button>
            <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => setPv(null)}>{tx(locale, "Cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
