"use client";
import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EventDetail, EventItem } from "@/events/service";
import { EVENT_ROLES, ROLE_LABEL, type EventRoleName } from "@/events/roles";
import type { TeamMember, TenantMember } from "@/events/workflow";
import type { InvitationRow, Supplier } from "@/suppliers/service";
import InvitePanel from "./InvitePanel";
import EvaluationPanel from "./EvaluationPanel";
import CommercialPanel from "./CommercialPanel";
import StaffClarifications from "./StaffClarifications";
import FilePanel from "./FilePanel";
import type { FileRow } from "@/files/service";
import { deleteTenderAction, uploadTenderAction } from "../../app/events/[id]/actions";
import type { Thread } from "@/clarifications/service";
import type { ComView } from "@/commercial/service";
import type { EvalView } from "@/evaluation/service";
import { addItemAction, approveAction, assignRoleAction, deleteItemAction, removeRoleAction, submitAction, updateBasicsAction } from "../../app/events/[id]/actions";

type Row = EventItem & { pending?: boolean };
type Op = { kind: "add"; row: Row } | { kind: "del"; id: string };
const isoDay = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const STATE: Record<string, string> = { draft: "Draft", pending_publication: "Waiting for approval", published: "Open", awarded: "Awarded", cancelled: "Cancelled" };

export default function EventDetailView({ event, team, myRoles, people, isAdmin, suppliers, invitations, evalView, comView, clar, tenderDocs, bidFiles }: { tenderDocs: FileRow[]; bidFiles: FileRow[]; clar: { threads: Thread[]; canAnswer: boolean } | null; comView: ComView | null; evalView: EvalView | null; event: EventDetail; team: TeamMember[]; myRoles: EventRoleName[]; people: TenantMember[]; isAdmin: boolean; suppliers: Supplier[]; invitations: InvitationRow[] }) {
  const draft = event.state === "draft";
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [teamRows, setTeamRows] = useState<TeamMember[]>(team);
  const canSubmit = draft && myRoles.includes("buyer");
  const canApprove = event.state === "pending_publication" && myRoles.includes("publication_approver");

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null); setBusy(true);
    const res = await fn().catch(() => ({ ok: false, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!res.ok) { setError(("error" in res && res.error) || "That is not allowed."); return; }
    after?.(); router.refresh();
  }
  const refreshTeam = () => router.refresh();
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

      {(canSubmit || canApprove || event.state === "pending_publication" || event.state === "published") && (
        <div className="card detail flow">
          <div className="row"><h3>{event.state === "published" ? "Published" : event.state === "pending_publication" ? "Waiting for approval" : "Ready to submit?"}</h3></div>
          {canSubmit && <div className="actions"><button className="btn" type="button" disabled={busy} onClick={() => run(() => submitAction(event.id, event.stateVersion))}>{busy ? "Submitting..." : "Submit for approval"}</button><span className="sub">Needs at least one item, a future closing date and an approver on the team.</span></div>}
          {canApprove && <div className="actions"><button className="btn" type="button" disabled={busy} onClick={() => run(() => approveAction(event.id, event.stateVersion))}>{busy ? "Publishing..." : "Approve and publish"}</button></div>}
          {event.state === "pending_publication" && !canApprove && <div className="sub">A publication approver on the team has to approve this event before it opens to suppliers.</div>}
          {event.state === "published" && <div className="sub">This event is open to invited suppliers.</div>}
        </div>
      )}

      {(myRoles.includes("buyer") || tenderDocs.length > 0) && <FilePanel title="Tender documents" hint="Visible to invited suppliers once the event is published. Published documents can be added to, not removed." files={tenderDocs}
        canUpload={myRoles.includes("buyer") && (draft || event.state === "published")} canDelete={myRoles.includes("buyer") && draft}
        upload={(f) => uploadTenderAction(event.id, f)} remove={(id) => deleteTenderAction(event.id, id)} />}

      {evalView && <EvaluationPanel key={`${event.state}:${event.stateVersion}`} eventId={event.id} view={evalView} />}

      {bidFiles.length > 0 && <FilePanel title="Bidder attachments" hint="Files bidders attached to their technical response." files={bidFiles} canUpload={false} canDelete={false} upload={async () => ({ ok: false })} remove={async () => ({ ok: false })} />}

      {clar && (clar.threads.length > 0 || clar.canAnswer) && <StaffClarifications eventId={event.id} threads={clar.threads} canAnswer={clar.canAnswer} open={event.state === "published"} />}

      {comView && <CommercialPanel key={`${event.state}:${event.stateVersion}`} eventId={event.id} view={comView} />}

      {event.state === "published" && (isAdmin || myRoles.includes("buyer")) && <InvitePanel eventId={event.id} suppliers={suppliers} invitations={invitations} />}

      <div className="card detail">
        <div className="row"><h3>Team</h3><span className="sub">{teamRows.length} {teamRows.length === 1 ? "assignment" : "assignments"}</span></div>
        <ul className="team">
          {team.map((m) => (
            <li key={m.membershipId + m.role}><span>{m.email}</span><span className="pill">{ROLE_LABEL[m.role]}</span>
              {isAdmin && draft && <button className="btn ghost" type="button" disabled={busy} onClick={() => run(() => removeRoleAction(event.id, m.membershipId, m.role), refreshTeam)}>Remove</button>}</li>
          ))}
        </ul>
        {isAdmin && draft && (
          <form className="additem team-add" action={(fd) => run(() => assignRoleAction(event.id, String(fd.get("who")), String(fd.get("role"))), refreshTeam)}>
            <select name="who" aria-label="Person" required defaultValue="">
              <option value="" disabled>Choose a person</option>
              {people.map((p) => <option key={p.membershipId} value={p.membershipId}>{p.email}</option>)}
            </select>
            <select name="role" aria-label="Role" defaultValue="buyer">{EVENT_ROLES.filter((r) => r !== "requester").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
            <button className="btn" type="submit" disabled={busy}>Add to team</button>
          </form>
        )}
        {!isAdmin && draft && <div className="sub">An administrator assigns the team.</div>}
      </div>

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
