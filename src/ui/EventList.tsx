"use client";
import { useDeferredValue, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { EventSummary, TemplateRow } from "@/events/service";
import { dateLocale, t, type Key, type Locale } from "@/i18n/dict";
import { createEventAction, createFromTemplateAction } from "../../app/events-actions";

const LABEL: Record<string, Key> = {
  draft: "sDraft", pending_publication: "sPending", published: "sPublished", closed: "sClosed",
  technical_evaluation: "sEvaluating", technical_approved: "sEvaluating", commercial_evaluation: "sEvaluating",
  recommended: "sRecommended", pending_award: "sPendingAward", awarded: "sAwarded", handover_pending: "sHandover",
  handed_over: "sHandedOver", archived: "sArchived", cancelled: "sCancelled", retendered: "sRetendered",
};
const STATUS_KEYS: [string, Key][] = [["All status", "allStatus"], ["Draft", "stDraft"], ["Open", "stOpen"], ["Evaluating", "stEvaluating"], ["Awarded", "stAwarded"], ["Cancelled", "stCancelled"]];
const GROUP: Record<string, string> = {
  draft: "Draft", pending_publication: "Draft", published: "Open", closed: "Evaluating", technical_evaluation: "Evaluating",
  technical_approved: "Evaluating", commercial_evaluation: "Evaluating", recommended: "Evaluating", pending_award: "Evaluating",
  awarded: "Awarded", handover_pending: "Awarded", handed_over: "Awarded", archived: "Archived", cancelled: "Cancelled", retendered: "Cancelled",
};
const PILL: Record<string, string> = { Open: "live", Evaluating: "warn", Awarded: "done" };
const fmtDate = (iso: string | null, l: Locale) => (iso ? new Date(iso).toLocaleDateString(dateLocale(l), { day: "numeric", month: "short", year: "numeric" }) : t(l, "noClosing"));
const fmtAed = (v: string | null, l: Locale) => (v == null ? t(l, "notEstimated") : `${l === "ar" ? "درهم" : "AED"} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

type Row = EventSummary & { pending?: boolean };

export default function EventList({ events, templates = [], locale = "en" }: { events: EventSummary[]; templates?: TemplateRow[]; locale?: Locale }) {
  const [rows, setRows] = useState<Row[]>(events);
  const [optimistic, addOptimistic] = useOptimistic<Row[], Row>(rows, (cur, add) => [add, ...cur]);
  const [, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("All status");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dq = useDeferredValue(q);
  const form = useRef<HTMLFormElement>(null);

  const shown = useMemo(() => {
    const t = dq.trim().toLowerCase();
    return optimistic.filter((e) =>
      (status === "All status" || GROUP[e.state] === status) &&
      (!t || e.title.toLowerCase().includes(t) || e.ref.toLowerCase().includes(t) || e.ownerDept.toLowerCase().includes(t)));
  }, [optimistic, dq, status]);

  const counts = useMemo(() => {
    const c = { total: optimistic.length, open: 0, evaluating: 0, awarded: 0 };
    optimistic.forEach((e) => { const g = GROUP[e.state]; if (g === "Open") c.open++; else if (g === "Evaluating") c.evaluating++; else if (g === "Awarded") c.awarded++; });
    return c;
  }, [optimistic]);

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
        <div className="kpi"><small>{t(locale, "kTotal")}</small><strong>{counts.total}</strong><em>{t(locale, "nAwarded", { n: counts.awarded })}</em></div>
        <div className="kpi"><small>{t(locale, "kOpen")}</small><strong>{counts.open}</strong></div>
        <div className="kpi orange"><small>{t(locale, "kEval")}</small><strong>{counts.evaluating}</strong></div>
        <div className="kpi green"><small>{t(locale, "kAwarded")}</small><strong>{counts.awarded}</strong></div>
      </section>

      <div className="toolbar">
        <input placeholder={t(locale, "searchEvents")} aria-label={t(locale, "searchEvents")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_KEYS.map(([v, k]) => <option key={v} value={v}>{t(locale, k)}</option>)}
        </select>
        <button className="btn" type="button" onClick={() => setOpen((o) => !o)}>{open ? t(locale, "closeBtn") : t(locale, "newEvent")}</button>
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
            <div className="meta"><span>{t(locale, "closesDate", { d: fmtDate(e.closesAt, locale) })}</span><span>{e.currency}</span></div>
            <div className="sep" />
            <div className="fig"><span>{t(locale, "estValue")}</span></div>
            <div className="val"><span>{fmtAed(e.valueAed, locale)}</span></div>
            {!e.pending && <div className="actions"><Link className="btn ghost" href={`/events/${e.id}`} prefetch>{t(locale, "openBtn")}</Link></div>}
          </article>
        ))}
        {shown.length === 0 && <div className="card"><h3>{optimistic.length ? t(locale, "noMatch") : t(locale, "noEventsYet")}</h3><div className="sub">{optimistic.length ? t(locale, "tryDifferent") : t(locale, "chooseNew")}</div></div>}
      </section>
    </>
  );
}
