"use client";
import { useOptimistic, useState, useTransition } from "react";
import type { EventDetail, EventItem } from "@/events/service";
import { addItemAction, deleteItemAction, updateBasicsAction } from "../../app/events/[id]/actions";

type Row = EventItem & { pending?: boolean };
type Op = { kind: "add"; row: Row } | { kind: "del"; id: string };
const isoDay = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const STATE: Record<string, string> = { draft: "Draft", published: "Open", awarded: "Awarded", cancelled: "Cancelled" };

export default function EventDetailView({ event }: { event: EventDetail }) {
  const draft = event.state === "draft";
  const [items, setItems] = useState<Row[]>(event.items);
  const [view, applyOp] = useOptimistic<Row[], Op>(items, (cur, op) => (op.kind === "add" ? [...cur, op.row] : cur.filter((r) => r.id !== op.id)));
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function add(fd: FormData, form: HTMLFormElement) {
    const input = { description: String(fd.get("description") ?? ""), quantity: String(fd.get("quantity") ?? ""), unit: String(fd.get("unit") ?? "").toUpperCase() };
    if (!input.description.trim()) { setError("Enter a description."); return; }
    setError(null); form.reset();
    const temp: Row = { id: `tmp-${Date.now()}`, lineNo: (items.at(-1)?.lineNo ?? 0) + 1, description: input.description.trim(), quantity: input.quantity, unit: input.unit, blockType: "UNIT_PRICE", pending: true };
    start(async () => {
      applyOp({ kind: "add", row: temp });
      const res = await addItemAction(event.id, input).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
      if (res.ok) setItems((r) => [...r, res.item]); else setError(res.error);
    });
  }
  function remove(id: string) {
    setError(null);
    start(async () => {
      applyOp({ kind: "del", id });
      const res = await deleteItemAction(event.id, id).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
      if (res.ok) setItems((r) => r.filter((x) => x.id !== id)); else setError(res.error);
    });
  }
  function saveBasics(fd: FormData) {
    setError(null); setSaved(null);
    start(async () => {
      const res = await updateBasicsAction(event.id, { title: String(fd.get("title") ?? ""), ownerDept: String(fd.get("dept") ?? ""), closesAt: String(fd.get("closes") ?? "") });
      if (res.ok) setSaved("Saved"); else setError(res.error);
    });
  }

  return (
    <>
      <div className="card detail">
        <div className="row"><h3>Details</h3><span className="pill">{STATE[event.state] ?? event.state}</span></div>
        <form action={saveBasics} className="newform" style={{ maxWidth: "none" }}>
          <label>Title<input name="title" defaultValue={event.title} disabled={!draft} required minLength={3} maxLength={200} /></label>
          <div className="two">
            <label>Department<input name="dept" defaultValue={event.ownerDept} disabled={!draft} maxLength={100} /></label>
            <label>Closing date<input name="closes" type="date" defaultValue={isoDay(event.closesAt)} disabled={!draft} /></label>
          </div>
          {draft && <div className="actions"><button className="btn" type="submit">Save details</button>{saved && <span className="sub">{saved}</span>}</div>}
          {!draft && <div className="sub">This event is no longer a draft, so its details are locked.</div>}
        </form>
      </div>

      {error && <div className="alert" role="alert">{error}</div>}

      <div className="card detail">
        <div className="row"><h3>Items to price</h3><span className="sub">{view.length} {view.length === 1 ? "item" : "items"}</span></div>
        <div className="tablewrap">
          <table className="items">
            <thead><tr><th>#</th><th>Description</th><th className="num">Quantity</th><th>Unit</th><th>Pricing</th>{draft && <th />}</tr></thead>
            <tbody>
              {view.map((i) => (
                <tr key={i.id} className={i.pending ? "saving" : ""}>
                  <td>{i.lineNo}</td><td>{i.description}</td><td className="num">{Number(i.quantity).toLocaleString("en-US", { maximumFractionDigits: 3 })}</td><td>{i.unit}</td>
                  <td>Unit price</td>
                  {draft && <td className="num"><button className="btn ghost" type="button" disabled={i.pending} onClick={() => remove(i.id)}>Remove</button></td>}
                </tr>
              ))}
              {view.length === 0 && <tr><td colSpan={6} className="sub">No items yet.{draft ? " Add the first one below." : ""}</td></tr>}
            </tbody>
          </table>
        </div>
        {draft && (
          <form action={(fd) => add(fd, document.getElementById("additem") as HTMLFormElement)} id="additem" className="additem">
            <input name="description" placeholder="Description, e.g. Process pump API 610" aria-label="Description" required maxLength={500} />
            <input name="quantity" placeholder="Qty" aria-label="Quantity" required inputMode="decimal" pattern="\d{1,15}(\.\d{1,3})?" title="A positive number, up to 3 decimals" />
            <input name="unit" placeholder="Unit" aria-label="Unit" required maxLength={20} defaultValue="EA" />
            <button className="btn" type="submit">Add item</button>
          </form>
        )}
      </div>
    </>
  );
}
