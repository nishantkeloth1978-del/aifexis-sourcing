"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportRow } from "@/events/service";
import { importItemsAction, previewItemsAction } from "../../app/events/[id]/actions";

type Preview = { rows: ImportRow[]; errors: { row: number; message: string }[]; total: number };

export default function ImportItems({ eventId }: { eventId: string }) {
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
        <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => input.current?.click()}>{busy === "read" ? "Reading..." : "Import from Excel or CSV"}</button>
        <a className="sublink" href="/api/templates/items">Download template</a>
      </div>
      {error && <div className="alert" role="alert" style={{ marginTop: 10 }}>{error}</div>}
      {preview && (
        <div style={{ marginTop: 10 }}>
          <div><b>{preview.rows.length}</b> of {preview.total} lines are ready to import.{bad > 0 && <> <b>{bad}</b> {bad === 1 ? "has a problem" : "have problems"} and will be skipped.</>}</div>
          {bad > 0 && <ul className="errlist">{preview.errors.slice(0, 8).map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}{bad > 8 && <li>and {bad - 8} more</li>}</ul>}
          {preview.rows.length > 0 && (
            <div className="tablewrap"><table className="items"><thead><tr><th>Description</th><th className="num">Qty</th><th>Unit</th><th>Pricing</th></tr></thead><tbody>
              {preview.rows.slice(0, 6).map((r, i) => <tr key={i}><td>{r.description}</td><td className="num">{r.quantity}</td><td>{r.unit}</td><td>{r.blockType === "LUMP_SUM" ? "Lump sum" : "Unit price"}</td></tr>)}
              {preview.rows.length > 6 && <tr><td colSpan={4} className="sub">and {preview.rows.length - 6} more</td></tr>}
            </tbody></table></div>)}
          <div className="actions">
            <button type="button" className="btn" disabled={busy !== null || preview.rows.length === 0} onClick={confirm}>{busy === "save" ? "Importing..." : `Import ${preview.rows.length} lines`}</button>
            <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
