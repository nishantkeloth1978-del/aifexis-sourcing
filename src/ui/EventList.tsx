"use client";
import { useDeferredValue, useMemo, useOptimistic, useState, useTransition } from "react";
import type { DemoEvent } from "@/demo/events";
import { copyEventAction } from "../../app/actions";

const PILL: Record<string, string> = { Open: "live", Evaluating: "warn", Awarded: "done", Draft: "", Cancelled: "" };
type Row = DemoEvent & { pending?: boolean };

export default function EventList({ events }: { events: DemoEvent[] }) {
  const [rows, setRows] = useState<Row[]>(events);
  const [optimistic, addOptimistic] = useOptimistic<Row[], Row>(rows, (cur, add) => [add, ...cur]);
  const [, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("All status");
  const [failed, setFailed] = useState<string | null>(null);
  const dq = useDeferredValue(q);

  // Filtering is local and instant: no server round trip while typing.
  const shown = useMemo(() => {
    const t = dq.trim().toLowerCase();
    return optimistic.filter((e) =>
      (status === "All status" || e.status === status) &&
      (!t || e.title.toLowerCase().includes(t) || e.ref.toLowerCase().includes(t) || e.owner.toLowerCase().includes(t)));
  }, [optimistic, dq, status]);

  function copy(src: Row) {
    const ref = `${src.ref}-COPY`;
    const draft: Row = { ...src, ref, title: `${src.title} (copy)`, status: "Draft", value: "AED 0.00", saving: "AED 0.00", pending: true };
    setFailed(null);
    startTransition(async () => {
      addOptimistic(draft); // card appears on screen immediately
      try {
        const res = await copyEventAction(src.ref); // backend takes its time
        if (res.ok) setRows((r) => [{ ...draft, pending: false }, ...r]);
        else setFailed(src.ref);
      } catch {
        setFailed(src.ref);
      }
    });
  }

  return (
    <>
      <div className="toolbar">
        <input placeholder="Search events..." aria-label="Search events" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {["All status", "Open", "Evaluating", "Awarded", "Draft", "Cancelled"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      {failed && <div className="alert" role="alert">The copy of {failed} could not be saved. Nothing was changed.</div>}
      <section className="grid">
        {shown.map((e) => (
          <article className={`card${e.pending ? " saving" : ""}`} key={e.ref}>
            <div className="row"><span className="ref">{e.ref}</span>
              {e.pending ? <span className="pill">Saving...</span> : <span className={`pill ${PILL[e.status]}`}>{e.status}</span>}</div>
            <h3>{e.title}</h3>
            <div className="sub">{e.owner}</div>
            <div className="meta"><span>Closes {e.closes}</span><span>{e.currency}</span></div>
            <div className="sep" />
            <div className="fig"><span>Estimated value</span><span>Savings</span></div>
            <div className="val"><span>{e.value}</span><span className="g">{e.saving}</span></div>
            <div className="actions">
              <button className="btn ghost" type="button">Open</button>
              <button className="btn ghost" type="button" disabled={e.pending} onClick={() => copy(e)}>Copy</button>
            </div>
          </article>
        ))}
        {shown.length === 0 && <div className="card"><h3>No events match</h3><div className="sub">Try a different search or status.</div></div>}
      </section>
    </>
  );
}
