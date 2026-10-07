"use client";
import { useDeferredValue, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import type { EventSummary } from "@/events/service";
import { createEventAction } from "../../app/events-actions";

const LABEL: Record<string, string> = {
  draft: "Draft", pending_publication: "Pending approval", published: "Open", closed: "Closed",
  technical_evaluation: "Evaluating", technical_approved: "Evaluating", commercial_evaluation: "Evaluating",
  recommended: "Recommended", pending_award: "Pending award", awarded: "Awarded", handover_pending: "Handover",
  handed_over: "Handed over", archived: "Archived", cancelled: "Cancelled", retendered: "Retendered",
};
const GROUP: Record<string, string> = {
  draft: "Draft", pending_publication: "Draft", published: "Open", closed: "Evaluating", technical_evaluation: "Evaluating",
  technical_approved: "Evaluating", commercial_evaluation: "Evaluating", recommended: "Evaluating", pending_award: "Evaluating",
  awarded: "Awarded", handover_pending: "Awarded", handed_over: "Awarded", archived: "Archived", cancelled: "Cancelled", retendered: "Cancelled",
};
const PILL: Record<string, string> = { Open: "live", Evaluating: "warn", Awarded: "done" };
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "No closing date");
const fmtAed = (v: string | null) => (v == null ? "Not estimated" : `AED ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

type Row = EventSummary & { pending?: boolean };

export default function EventList({ events }: { events: EventSummary[] }) {
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
    setError(null); setOpen(false); form.current?.reset();
    const temp: Row = { id: `tmp-${Date.now()}`, ref: "Saving...", title: input.title.trim(), ownerDept: input.ownerDept.trim(), state: "draft",
      valueAed: null, closesAt: input.closesAt ? new Date(input.closesAt).toISOString() : null, currency: "AED", createdAt: new Date().toISOString(), pending: true };
    startTransition(async () => {
      addOptimistic(temp); // appears on screen at once
      const res = await createEventAction(input).catch(() => ({ ok: false as const, error: "The event could not be saved. Try again." }));
      if (res.ok) setRows((r) => [res.event, ...r]);
      else setError(res.error);
    });
  }

  return (
    <>
      <section className="kpis">
        <div className="kpi"><small>Total events</small><strong>{counts.total}</strong><em>{counts.awarded} awarded</em></div>
        <div className="kpi"><small>Open for bids</small><strong>{counts.open}</strong></div>
        <div className="kpi orange"><small>In evaluation</small><strong>{counts.evaluating}</strong></div>
        <div className="kpi green"><small>Awarded</small><strong>{counts.awarded}</strong></div>
      </section>

      <div className="toolbar">
        <input placeholder="Search events..." aria-label="Search events" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {["All status", "Draft", "Open", "Evaluating", "Awarded", "Cancelled"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn" type="button" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ New event"}</button>
      </div>

      {open && (
        <form ref={form} action={submit} className="card newform">
          <h3>New event</h3>
          <label>Title<input name="title" required minLength={3} maxLength={200} autoFocus placeholder="e.g. Process pump set API 610" /></label>
          <div className="two">
            <label>Department<input name="dept" maxLength={100} placeholder="e.g. Procurement" /></label>
            <label>Closing date<input name="closes" type="date" /></label>
          </div>
          <div className="actions"><button className="btn" type="submit">Create draft</button><button className="btn ghost" type="button" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
      {error && <div className="alert" role="alert">{error}</div>}

      <section className="grid">
        {shown.map((e) => (
          <article className={`card${e.pending ? " saving" : ""}`} key={e.id}>
            <div className="row"><span className="ref">{e.ref}</span>
              <span className={`pill ${e.pending ? "" : PILL[GROUP[e.state] ?? ""] ?? ""}`}>{e.pending ? "Saving..." : LABEL[e.state] ?? e.state}</span></div>
            <h3>{e.title}</h3>
            <div className="sub">{e.ownerDept || "No department"}</div>
            <div className="meta"><span>Closes {fmtDate(e.closesAt)}</span><span>{e.currency}</span></div>
            <div className="sep" />
            <div className="fig"><span>Estimated value</span></div>
            <div className="val"><span>{fmtAed(e.valueAed)}</span></div>
          </article>
        ))}
        {shown.length === 0 && <div className="card"><h3>{optimistic.length ? "No events match" : "No events yet"}</h3><div className="sub">{optimistic.length ? "Try a different search or status." : "Choose + New event to create your first one."}</div></div>}
      </section>
    </>
  );
}
