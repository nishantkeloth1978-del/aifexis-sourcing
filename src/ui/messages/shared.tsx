"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { tx } from "@/i18n/tx";
import { dateLocale, type Locale } from "@/i18n/dict";
import type { Deadlines, Msg, Overview } from "@/messages/service";

export const fmt = (iso: string | null, locale: Locale) => (iso ? new Date(iso).toLocaleString(dateLocale(locale), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");
export const toLocalInput = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

/** Keeps an overview fresh: re-reads it every 20 seconds while the page is visible, and on demand. */
export function useLive(initial: Overview, poll: () => Promise<{ ok: true; overview: Overview } | { ok: false; error: string }>) {
  const [ov, setOv] = useState(initial);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) return; busy.current = true;
    try { const r = await poll(); if (r.ok) setOv(r.overview); } catch { /* keep the last view */ } finally { busy.current = false; }
  }, [poll]);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 20000);
    const vis = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [refresh]);
  return { ov, refresh };
}

export function Bubbles({ msgs, locale, staffView }: { msgs: Msg[]; locale: Locale; staffView: boolean }) {
  if (!msgs.length) return null;
  return (
    <div className="msgs" role="log" aria-live="polite">
      {msgs.map((m) => (
        <div key={m.id} className={`bubble ${m.mine ? "mine" : ""} ${m.internal ? "internal" : ""} ${m.by === "system" ? "system" : ""}`}>
          <div className="meta">
            <b>{m.by === "system" ? tx(locale, "System") : m.internal ? tx(locale, "Internal note") : staffView ? (m.by === "supplier" ? tx(locale, "Supplier") : (m.byName ?? tx(locale, "Buyer team"))) : (m.by === "supplier" ? tx(locale, "You") : tx(locale, "Buyer"))}</b>
            <span className="sub"> · {fmt(m.at, locale)}</span>
            {m.unread && <span className="chip new"> {tx(locale, "New")}</span>}
          </div>
          <div className="body">{m.body}</div>
          {m.files.length > 0 && <ul className="files">{m.files.map((f) => <li key={f.id}><a href={`/api/messages/files/${f.id}`}>{f.filename}</a> <span className="sub">({Math.max(1, Math.round(f.size / 1024))} KB)</span></li>)}</ul>}
          {m.guardReason && staffView && <div className="sub">{tx(locale, "Kept private because")}: {m.guardReason}</div>}
        </div>
      ))}
    </div>
  );
}

/** A text box with up to three files. The caller decides what sending means. */
export function Composer({ locale, label, button, onSend, disabled, children }: { locale: Locale; label: string; button: string; onSend: (fd: FormData) => Promise<{ ok: boolean; error?: string }>; disabled?: boolean; children?: React.ReactNode }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(null); setBusy(true);
    const r = await onSend(new FormData(e.currentTarget)).catch(() => ({ ok: false, error: "That could not be sent. Try again." }));
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? "That could not be sent. Try again."); return; }
    form.current?.reset();
  }
  return (
    <form ref={form} onSubmit={submit} className="composer">
      <label>{label}<textarea name="text" rows={3} maxLength={4000} required disabled={disabled || busy} /></label>
      {children}
      <label className="sub">{tx(locale, "Attach files (up to 3, 4 MB each)")} <input type="file" name="file" multiple disabled={disabled || busy} /></label>
      {err && <div className="alert" role="alert">{tx(locale, err)}</div>}
      <div className="actions"><button className="btn" type="submit" disabled={disabled || busy}>{button}</button></div>
    </form>
  );
}

export function Deadlines({ d, locale, late }: { d: Deadlines; locale: Locale; late?: boolean }) {
  if (!d.questionDeadline && !d.lastAnswerDate) return null;
  return (
    <div className="sub" style={{ margin: "6px 0" }}>
      {d.questionDeadline && <span>{tx(locale, "Questions close {d}", { d: fmt(d.questionDeadline, locale) })}</span>}
      {d.questionDeadline && d.lastAnswerDate && " · "}
      {d.lastAnswerDate && <span>{tx(locale, "Answers by {d}", { d: fmt(d.lastAnswerDate, locale) })}</span>}
      {late && <b> · {tx(locale, "Answers are late")}</b>}
    </div>
  );
}

export function TabBar<T extends string>({ tabs, on, set, locale }: { tabs: { key: T; label: string; badge?: number }[]; on: T; set: (k: T) => void; locale: Locale }) {
  return (
    <div className="tabs" role="tablist" aria-label={tx(locale, "Messages")}>
      {tabs.map((t) => <button key={t.key} type="button" role="tab" aria-selected={on === t.key} className={on === t.key ? "on" : ""} onClick={() => set(t.key)}>{t.label}{t.badge ? <span className="badge"> {t.badge}</span> : null}</button>)}
    </div>
  );
}
