"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FileRow } from "@/files/service";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";

const kb = (n: number, locale: Locale) => (n >= 1048576 ? tx(locale, "{n} MB", { n: (n / 1048576).toFixed(1) }) : tx(locale, "{n} KB", { n: Math.max(1, Math.round(n / 1024)) }));

/** A list of files with optional upload and delete. A new file appears at once, marked as uploading, while it is sent. */
export default function FilePanel({ title, hint, files, canUpload, canDelete, upload, remove, locale = "en" }: {
  title: string; hint?: string; files: FileRow[]; canUpload: boolean; canDelete: boolean;
  upload: (form: FormData) => Promise<{ ok: boolean; error?: string }>; remove: (id: string) => Promise<{ ok: boolean; error?: string }>; locale?: Locale;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [gone, setGone] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setError(null);
    if (f.size > 4 * 1024 * 1024) { setError(tx(locale, "The file is larger than 4 MB.")); return; }
    setPending((p) => [...p, f.name]);
    const fd = new FormData(); fd.set("file", f);
    const r = await upload(fd).catch(() => ({ ok: false, error: "That could not be uploaded. Try again." }));
    setPending((p) => p.filter((n) => n !== f.name));
    if (!r.ok) { setError(r.error ?? "That could not be uploaded."); return; }
    router.refresh();
  }
  async function del(id: string) {
    setError(null); setGone((g) => [...g, id]);
    const r = await remove(id).catch(() => ({ ok: false, error: "That could not be removed. Try again." }));
    if (!r.ok) { setGone((g) => g.filter((x) => x !== id)); setError(r.error ?? "That could not be removed."); return; }
    router.refresh();
  }
  const shown = files.filter((f) => !gone.includes(f.id));
  return (
    <div className="card detail">
      <div className="row"><h3>{title}</h3><span className="sub">{shown.length + pending.length}</span></div>
      {hint && <div className="sub">{hint}</div>}
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      {shown.length + pending.length === 0 && <div className="sub">{tx(locale, "No files yet.")}</div>}
      <ul className="team">
        {shown.map((f) => (
          <li key={f.id}><span>{f.supplierName && <span className="sub">{f.supplierName}: </span>}<a className="sublink" href={`/api/files/${f.id}`}>{f.filename}</a> <span className="sub">{kb(f.size, locale)}</span></span>
            {canDelete && <button type="button" className="btn ghost" onClick={() => del(f.id)}>{tx(locale, "Remove")}</button>}</li>
        ))}
        {pending.map((n, i) => <li key={`p${i}`} style={{ opacity: 0.6 }}><span>{n} <span className="sub">{tx(locale, "Uploading...")}</span></span></li>)}
      </ul>
      {canUpload && <div className="actions"><input ref={input} type="file" hidden onChange={onPick} /><button type="button" className="btn ghost" onClick={() => input.current?.click()}>{tx(locale, "Add file")}</button><span className="sub">{tx(locale, "PDF, Word, Excel, images, zip. Up to 4 MB each.")}</span></div>}
    </div>
  );
}
