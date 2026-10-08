"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportRow } from "@/events/service";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { importItemsAction, previewItemsAction } from "../../app/events/[id]/actions";

type Preview = { rows: ImportRow[]; errors: { row: number; message: string }[]; total: number };

export default function ImportItems({ eventId, locale = "en" }: { eventId: string; locale?: Locale }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setError(null); setPreview(null); setBusy("read");
    const fd = new FormData(); fd.set("file", f);
    const r = await previewItemsAction(fd).catch(() => ({ ok: false as const, error: "That file could not be read." }));
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setPreview({ rows: r.rows, errors: r.errors, total: r.total });
  }
  async function confirm() {
    if (!preview) return;
    setError(null); setBusy("save");
    const r = await importItemsAction(eventId, preview.rows).catch(() => ({ ok: false, error: "That could not be saved. Try again." }));
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "That is not allowed."); return; }
    setPreview(null); router.refresh();
  }
  const bad = preview?.errors.length ?? 0;
  return (
    <div className="importbox">
      <div className="actions" style={{ marginTop: 0 }}>
        <input ref={input} type="file" hidden accept=".xlsx,.csv" onChange={pick} />
        <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => input.current?.click()}>{busy === "read" ? tx(locale, "Reading...") : tx(locale, "Import from Excel or CSV")}</button>
        <a className="sublink" href="/api/templates/items">{tx(locale, "Download template")}</a>
      </div>
      {error && <div className="alert" role="alert" style={{ marginTop: 10 }}>{tx(locale, error)}</div>}
      {preview && (
        <div style={{ marginTop: 10 }}>
          <div>{tx(locale, "{n} of {total} lines are ready to import.", { n: preview.rows.length, total: preview.total })}{bad > 0 && <> {bad === 1 ? tx(locale, "1 has a problem and will be skipped.") : tx(locale, "{n} have problems and will be skipped.", { n: bad })}</>}</div>
          {bad > 0 && <ul className="errlist">{preview.errors.slice(0, 8).map((e) => <li key={e.row}>{tx(locale, "Row {n}:", { n: e.row })} {tx(locale, e.message)}</li>)}{bad > 8 && <li>{tx(locale, "and {n} more", { n: bad - 8 })}</li>}</ul>}
          {preview.rows.length > 0 && (
            <div className="tablewrap"><table className="items"><thead><tr><th>{tx(locale, "Description")}</th><th className="num">{tx(locale, "Qty")}</th><th>{tx(locale, "Unit")}</th><th>{tx(locale, "Pricing")}</th></tr></thead><tbody>
              {preview.rows.slice(0, 6).map((r, i) => <tr key={i}><td>{r.description}</td><td className="num">{r.quantity}</td><td>{r.unit}</td><td>{r.blockType === "LUMP_SUM" ? tx(locale, "Lump sum") : tx(locale, "Unit price")}</td></tr>)}
              {preview.rows.length > 6 && <tr><td colSpan={4} className="sub">{tx(locale, "and {n} more", { n: preview.rows.length - 6 })}</td></tr>}
            </tbody></table></div>)}
          <div className="actions">
            <button type="button" className="btn" disabled={busy !== null || preview.rows.length === 0} onClick={confirm}>{busy === "save" ? tx(locale, "Importing...") : tx(locale, "Import {n} lines", { n: preview.rows.length })}</button>
            <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => setPreview(null)}>{tx(locale, "Cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
