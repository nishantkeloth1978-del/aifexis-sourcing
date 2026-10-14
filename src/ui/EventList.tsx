"use client";
import { useOptimistic, useRef, useState, useTransition } from "react";
import LiveClock from "./LiveClock";
import Link from "next/link";
import type { EventPage, EventSummary, TemplateRow } from "@/events/service";
import { STATE_GROUP as GROUP } from "@/events/groups";
import { tx } from "@/i18n/tx";
import { dateLocale, t, type Key, type Locale } from "@/i18n/dict";
import { createEventAction, createFromTemplateAction } from "../../app/events-actions";

const LABEL: Record<string, Key> = {
  draft: "sDraft", pending_publication: "sPending", published: "sPublished", closed: "sClosed",
  technical_evaluation: "sEvaluating", technical_approved: "sEvaluating", commercial_evaluation: "sEvaluating",
  recommended: "sRecommended", pending_award: "sPendingAward", awarded: "sAwarded", handover_pending: "sHandover",
  handed_over: "sHandedOver", archived: "sArchived", cancelled: "sCancelled", retendered: "sRetendered",
};
const STATUS_KEYS: [string, Key][] = [["", "allStatus"], ["Draft", "stDraft"], ["Open", "stOpen"], ["Evaluating", "stEvaluating"], ["Awarded", "stAwarded"], ["Cancelled", "stCancelled"]];
const PILL: Record<string, string> = { Open: "live", Evaluating: "warn", Awarded: "done" };
const fmtDate = (iso: string | null, l: Locale) => (iso ? new Date(iso).toLocaleDateString(dateLocale(l), { day: "numeric", month: "short", year: "numeric" }) : t(l, "noClosing"));
const fmtAed = (v: string | null, l: Locale) => (v == null ? t(l, "notEstimated") : `${l === "ar" ? "درهم" : "AED"} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

type Row = EventSummary & { pending?: boolean };

export default function EventList({ page, q, status, templates = [], locale = "en" }: { page: EventPage; q: string; status: string; templates?: TemplateRow[]; locale?: Locale }) {
  const [rows, setRows] = useState<Row[]>([]);   // events created on this screen, shown at once until the page is reloaded
  const [optimistic, addOptimistic] = useOptimistic<Row[], Row>(rows, (cur, add) => [add, ...cur]);
  const filtered = Boolean(q || status);
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  const counts = page.counts;
  const shown: Row[] = [...(filtered || page.page > 1 ? [] : optimistic.filter((r) => !page.rows.some((p) => p.id === r.id))), ...page.rows];

  function submit(fd: FormData) {
    const input = { title: String(fd.get("title") ?? ""), ownerDept: String(fd.get("dept") ?? ""), closesAt: String(fd.get("closes") ?? "") };
    if (input.title.trim().length < 3) { setError("Enter a title of at least 3 characters."); return; }
    const tpl = String(fd.get("template") ?? "");
    setError(null); setOpen(false); form.current?.reset();
    const temp: Row = { id: `tmp-${Date.now()}`, ref: "Saving...", title: input.title.trim(), ownerDept: input.ownerDept.trim(), state: "draft",
      valueAed: null, closesAt: input.closesAt ? new Date(input.closesAt).toISOString() : null, currency: "AED", createdAt: new Date().toISOString(), pending: true };
    startTransition(async () => {
      addOptimistic(temp); // appears on screen at once
      const res = await (tpl ? createFromTemplateAction(tpl, input) : createEventAction(input)).catch(() => ({ ok: false as const, error: "The event could not be saved. Try again." }));
      if (res.ok) setRows((r) => [res.event, ...r]);
      else setError(res.error);
    });
  }

  return (
    <>
      <section className="kpis">
        <div className="kpi"><small>{t(locale, "kTotal")}</small><strong>{counts.total + optimistic.length}</strong><em>{t(locale, "nAwarded", { n: counts.awarded })}</em></div>
        <div className="kpi"><small>{t(locale, "kOpen")}</small><strong>{counts.open}</strong></div>
        <div className="kpi orange"><small>{t(locale, "kEval")}</small><strong>{counts.evaluating}</strong></div>
        <div className="kpi green"><small>{t(locale, "kAwarded")}</small><strong>{counts.awarded}</strong></div>
      </section>

      <div className="toolbar">
        <form method="get" role="search" style={{ display: "contents" }}>
          <input name="q" type="search" placeholder={t(locale, "searchEvents")} aria-label={t(locale, "searchEvents")} defaultValue={q} maxLength={100} />
          <select name="status" aria-label={tx(locale, "Status")} defaultValue={status} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
            {STATUS_KEYS.map(([v, k]) => <option key={v} value={v}>{t(locale, k)}</option>)}
          </select>
          <button className="btn ghost" type="submit">{tx(locale, "Search")}</button>
        </form>
        <button className="btn" type="button" onClick={() => setOpen((o) => !o)}>{open ? t(locale, "closeBtn") : t(locale, "newEvent")}</button>
        <Link className="btn ghost" href="/events/new">{tx(locale, "New from industry template")}</Link>
      </div>

      {open && (
        <form ref={form} action={submit} className="card newform">
          <h3>{t(locale, "formNew")}</h3>
          {templates.length > 0 && <label>{t(locale, "startFrom")}<select name="template" defaultValue=""><option value="">{t(locale, "blankEvent")}</option>{templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name} ({t(locale, "nLines", { n: tp.lineCount })})</option>)}</select></label>}
          <label>{t(locale, "fTitle")}<input name="title" required minLength={3} maxLength={200} autoFocus placeholder="e.g. Process pump set API 610" /></label>
          <div className="two">
            <label>{t(locale, "fDept")}<input name="dept" maxLength={100} placeholder="e.g. Procurement" /></label>
            <label>{t(locale, "fClosing")}<input name="closes" type="date" /></label>
          </div>
          <div className="actions"><button className="btn" type="submit">{t(locale, "createDraft")}</button><button className="btn ghost" type="button" onClick={() => setOpen(false)}>{t(locale, "cancel")}</button></div>
        </form>
      )}
      {error && <div className="alert" role="alert">{error}</div>}

      <section className="grid">
        {shown.map((e) => (
          <article className={`card${e.pending ? " saving" : ""}`} key={e.id}>
            <div className="row"><span className="ref">{e.ref}</span>
              <span className={`pill ${e.pending ? "" : PILL[GROUP[e.state] ?? ""] ?? ""}`}>{e.pending ? t(locale, "saving") : LABEL[e.state] ? t(locale, LABEL[e.state]!) : e.state}</span></div>
            <h3>{e.title}</h3>
            <div className="sub">{e.ownerDept || t(locale, "noDept")}</div>
            <div className="meta"><span>{t(locale, "closesDate", { d: fmtDate(e.closesAt, locale) })}</span>{e.state === "published" && e.closesAt && <LiveClock closesAt={e.closesAt} locale={locale} />}<span>{e.currency}</span></div>
            <div className="sep" />
            <div className="fig"><span>{t(locale, "estValue")}</span></div>
            <div className="val"><span>{fmtAed(e.valueAed, locale)}</span></div>
            {!e.pending && <div className="actions"><Link className="btn ghost" href={`/events/${e.id}`} prefetch>{t(locale, "openBtn")}</Link></div>}
          </article>
        ))}
        {shown.length === 0 && <div className="card"><h3>{filtered ? t(locale, "noMatch") : t(locale, "noEventsYet")}</h3><div className="sub">{filtered ? t(locale, "tryDifferent") : t(locale, "chooseNew")}</div></div>}
      </section>
      {page.pages > 1 && (() => {
        const href = (n: number) => { const p = new URLSearchParams(); if (q) p.set("q", q); if (status) p.set("status", status); if (n > 1) p.set("page", String(n)); const s = p.toString(); return s ? `/?${s}` : "/"; };
        return <nav className="pager" aria-label={tx(locale, "Pages")}>
          {page.page > 1 ? <Link className="btn ghost" href={href(page.page - 1)} rel="prev">{tx(locale, "Previous")}</Link> : <span />}
          <span className="sub">{tx(locale, "Page {p} of {n}", { p: page.page, n: page.pages })} · {tx(locale, "{n} events", { n: page.total })}</span>
          {page.page < page.pages ? <Link className="btn ghost" href={href(page.page + 1)} rel="next">{tx(locale, "Next")}</Link> : <span />}
        </nav>;
      })()}
    </>
  );
}
