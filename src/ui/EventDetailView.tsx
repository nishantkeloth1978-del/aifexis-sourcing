"use client";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActivityRow, EventDetail, EventItem } from "@/events/service";
import type { Workspace } from "@/events/readiness";
import { EVENT_ROLES, ROLE_LABEL, type EventRoleName } from "@/events/roles";
import type { TeamMember, TenantMember } from "@/events/workflow";
import type { InvitationRow, Supplier } from "@/suppliers/service";
import InvitePanel from "./InvitePanel";
import EvaluationPanel from "./EvaluationPanel";
import CommercialPanel from "./CommercialPanel";
import StaffClarifications from "./StaffClarifications";
import FilePanel from "./FilePanel";
import ImportItems from "./ImportItems";
import EventStepper from "./EventStepper";
import SaveTemplate from "./SaveTemplate";
import { t, type Key, type Locale } from "@/i18n/dict";
import { tx } from "@/i18n/tx";
import type { FileRow } from "@/files/service";
import { deleteEventAction, deleteTenderAction, duplicateEventAction, uploadTenderAction } from "../../app/events/[id]/actions";
import type { Thread } from "@/clarifications/service";
import type { ComView } from "@/commercial/service";
import type { EvalView } from "@/evaluation/service";
import { addLotAction, deleteLotAction, setItemLotAction } from "../../app/events/[id]/actions";
import type { CatalogItem } from "@/catalog/service";
import { routeTeamAction } from "../../app/approvers/actions";
import { deleteItemsAction, updateItemCoreAction, addItemAction, updateItemDetailsAction, approveAction, assignRoleAction, deleteItemAction, removeRoleAction, submitAction, updateBasicsAction } from "../../app/events/[id]/actions";

type Row = EventItem & { pending?: boolean };
type Op = { kind: "add"; row: Row } | { kind: "del"; id: string };
const isoDay = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const STATE: Record<string, Key> = { draft: "sDraft", pending_publication: "sPending", published: "sPublished", awarded: "sAwarded", cancelled: "sCancelled" };

export default function EventDetailView({ locale = "en", event, team, myRoles, people, isAdmin, suppliers, invitations, catalog = [], evalView, comView, clar, tenderDocs, bidFiles, workspace, activity = [] }: { workspace: Workspace; activity?: ActivityRow[]; locale?: Locale; tenderDocs: FileRow[]; bidFiles: FileRow[]; clar: { threads: Thread[]; canAnswer: boolean } | null; comView: ComView | null; evalView: EvalView | null; event: EventDetail; team: TeamMember[]; myRoles: EventRoleName[]; people: TenantMember[]; isAdmin: boolean; suppliers: Supplier[]; invitations: InvitationRow[]; catalog?: CatalogItem[] }) {
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
  type Tab = "overview" | "items" | "docs" | "eval" | "team" | "activity";
  const [tab, setTab] = useState<Tab>("overview");
  const hasEval = Boolean(evalView || comView || clar || bidFiles.length);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const basicsRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editCore, setEditCore] = useState<string | null>(null);

  async function autosave() {
    const f = basicsRef.current; if (!f || !draft) return;
    const fd = new FormData(f);
    setSave("saving");
    const res = await updateBasicsAction(event.id, { title: String(fd.get("title") ?? ""), ownerDept: String(fd.get("dept") ?? ""), closesAt: String(fd.get("closes") ?? ""), valueAed: String(fd.get("value") ?? "") }).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    if (res.ok) { setSave("saved"); setError(null); } else { setSave("error"); setError(res.error); }
  }
  function queueSave() { if (!draft) return; setSave("saving"); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { void autosave(); }, 900); }
  function saveCore(itemId: string, fd: FormData) {
    const d = { description: String(fd.get("description") ?? ""), quantity: String(fd.get("quantity") ?? ""), unit: String(fd.get("unit") ?? "").toUpperCase() };
    setError(null);
    start(async () => {
      const res = await updateItemCoreAction(event.id, itemId, d).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
      if (res.ok) { setItems((r) => r.map((x) => (x.id === itemId ? res.item : x))); setEditCore(null); } else setError(res.error);
    });
  }
  function removeSelected() {
    const ids = [...sel]; if (!ids.length) return;
    if (!window.confirm(tx(locale, "Delete {n} selected items?", { n: ids.length }))) return;
    setError(null);
    start(async () => {
      const res = await deleteItemsAction(event.id, ids).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
      if (res.ok) { setItems((r) => r.filter((x) => !sel.has(x.id))); setSel(new Set()); router.refresh(); } else setError(res.error);
    });
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && draft) { e.preventDefault(); if (timer.current) clearTimeout(timer.current); void autosave(); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || !draft) return;
      if (e.key === "n") { e.preventDefault(); setTab("items"); setTimeout(() => (document.querySelector("#additem input[name=description]") as HTMLInputElement | null)?.focus(), 50); }
    }
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, event.id]);

  function add(fd: FormData, form: HTMLFormElement) {
    const input = { description: String(fd.get("description") ?? ""), quantity: String(fd.get("quantity") ?? ""), unit: String(fd.get("unit") ?? "").toUpperCase(), lotId: String(fd.get("lot") ?? "") || null, code: String(fd.get("code") ?? "").trim().toUpperCase() || null };
    if (!input.description.trim()) { setError("Enter a description."); return; }
    setError(null); form.reset();
    const temp: Row = { id: `tmp-${Date.now()}`, lineNo: (items.at(-1)?.lineNo ?? 0) + 1, description: input.description.trim(), quantity: input.quantity, unit: input.unit, blockType: "UNIT_PRICE", lotId: input.lotId, code: input.code, specification: null, requiredDate: null, materialGroup: null, targetPrice: null, pending: true };
    start(async () => {
      applyOp({ kind: "add", row: temp });
      const res = await addItemAction(event.id, input).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
      if (res.ok) setItems((r) => [...r, res.item]); else setError(res.error);
    });
  }
  const [editing, setEditing] = useState<string | null>(null);
  function saveDetails(itemId: string, fd: FormData) {
    const d = { specification: String(fd.get("specification") ?? ""), requiredDate: String(fd.get("requiredDate") ?? ""), materialGroup: String(fd.get("materialGroup") ?? ""), targetPrice: String(fd.get("targetPrice") ?? "") };
    setError(null);
    start(async () => {
      const res = await updateItemDetailsAction(event.id, itemId, d).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
      if (res.ok) { setItems((r) => r.map((x) => (x.id === itemId ? res.item : x))); setEditing(null); } else setError(res.error);
    });
  }
  function pickCode(e: React.ChangeEvent<HTMLInputElement>) {
    const hit = catalog.find((c) => c.code.toUpperCase() === e.target.value.trim().toUpperCase());
    const form = e.target.form; if (!hit || !form) return;
    (form.elements.namedItem("description") as HTMLInputElement).value = hit.description;
    (form.elements.namedItem("unit") as HTMLInputElement).value = hit.unit;
  }
  function remove(id: string) {
    setError(null);
    start(async () => {
      applyOp({ kind: "del", id });
      const res = await deleteItemAction(event.id, id).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
      if (res.ok) setItems((r) => r.filter((x) => x.id !== id)); else setError(res.error);
    });
  }
  const lots = event.lots;
  function setLot(itemId: string, lotId: string) {
    setError(null);
    start(async () => {
      const res = await setItemLotAction(event.id, itemId, lotId || null).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
      if (res.ok) setItems((r) => r.map((x) => (x.id === itemId ? { ...x, lotId: lotId || null } : x))); else setError(res.error);
    });
  }
  function dropLot(lotId: string) {
    setError(null);
    start(async () => {
      const res = await deleteLotAction(event.id, lotId).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
      if (res.ok) { setItems((r) => r.map((x) => (x.lotId === lotId ? { ...x, lotId: null } : x))); router.refresh(); } else setError(res.error);
    });
  }
  function newLot(fd: FormData, form: HTMLFormElement) {
    setError(null);
    const name = String(fd.get("lotname") ?? "");
    start(async () => {
      const res = await addLotAction(event.id, name).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
      if (res.ok) { form.reset(); router.refresh(); } else setError(res.error);
    });
  }
  function saveBasics(fd: FormData) {
    setError(null); setSaved(null);
    start(async () => {
      const res = await updateBasicsAction(event.id, { title: String(fd.get("title") ?? ""), ownerDept: String(fd.get("dept") ?? ""), closesAt: String(fd.get("closes") ?? ""), valueAed: String(fd.get("value") ?? "") });
      if (res.ok) setSaved("Saved"); else setError(res.error);
    });
  }

  return (
    <>
      <EventStepper state={event.state} locale={locale} />
      <div className="card detail workspace">
        <div className="row"><h3>{tx(locale, "Next step")}</h3><span className="pill">{save === "saving" ? tx(locale, "Saving...") : save === "saved" ? tx(locale, "All changes saved") : save === "error" ? tx(locale, "Not saved") : STATE[event.state] ? t(locale, STATE[event.state]!) : event.state}</span></div>
        <div><b>{tx(locale, workspace.next)}</b></div>
        {workspace.tasks.length > 0 && <ul className="tasks" style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>{workspace.tasks.map((k) => <li key={k.key}><span aria-hidden="true">{k.done ? "✓" : "○"}</span> <span style={k.done ? { opacity: 0.6 } : undefined}>{tx(locale, k.label)}{!k.required && <span className="sub"> ({tx(locale, "optional")})</span>}</span></li>)}</ul>}
        {draft && <div className="sub" style={{ marginTop: 6 }}>{tx(locale, "Shortcuts: Ctrl+S saves, N adds an item.")}</div>}
      </div>
      <div className="tabs" role="tablist" aria-label={tx(locale, "Event sections")} style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
        {([["overview", "Overview"], ["items", "Items"], ["docs", "Documents"], ...(hasEval || event.state === "published" ? [["eval", "Suppliers and evaluation"]] : []), ["team", "Team"], ["activity", "Activity"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "btn" : "btn ghost"} onClick={() => setTab(k)}>{tx(locale, label)}{k === "items" ? ` (${view.length})` : k === "docs" && tenderDocs.length ? ` (${tenderDocs.length})` : ""}</button>))}
      </div>
      <div hidden={tab !== "overview"}>
      <div className="card detail">
        <div className="row"><h3>{t(locale, "details")}</h3><span className="actions" style={{ margin: 0 }}>{event.items.length > 0 && <SaveTemplate locale={locale} eventId={event.id} defaultName={event.title} />}<span className="pill">{STATE[event.state] ? t(locale, STATE[event.state]!) : event.state}</span><form action={async () => { await duplicateEventAction(event.id); }}><button className="btn ghost" type="submit" title={t(locale, "copyTitle")}>{t(locale, "copyAsNew")}</button></form>{draft && <button className="btn ghost" type="button" disabled={busy} style={{ color: "var(--red, #b42318)" }} onClick={() => { if (window.confirm(tx(locale, "Delete this draft event? It will no longer appear in your lists."))) void run(async () => (await deleteEventAction(event.id)) ?? { ok: true }); }}>{tx(locale, "Delete event")}</button>}</span></div>
        <form ref={basicsRef} onChange={queueSave} action={saveBasics} className="newform" style={{ maxWidth: "none" }}>
          <label>{t(locale, "fTitle")}<input name="title" defaultValue={event.title} disabled={!draft} required minLength={3} maxLength={200} /></label>
          <div className="two">
            <label>{t(locale, "fDept")}<input name="dept" defaultValue={event.ownerDept} disabled={!draft} maxLength={100} /></label>
            <label>{t(locale, "fClosing")}<input name="closes" type="date" defaultValue={isoDay(event.closesAt)} disabled={!draft} /></label>
          </div>
          <label>{t(locale, "estValueAed")}<input name="value" inputMode="decimal" defaultValue={event.valueAed ?? ""} disabled={!draft} placeholder={t(locale, "estPlaceholder")} /></label>
          {draft && <div className="actions"><button className="btn" type="submit">{t(locale, "saveDetails")}</button>{saved && <span className="sub">{t(locale, "savedOk")}</span>}</div>}
          {!draft && <div className="sub">{t(locale, "detailsLocked")}</div>}
        </form>
      </div>

      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}

      {(canSubmit || canApprove || event.state === "pending_publication" || event.state === "published") && (
        <div className="card detail flow">
          <div className="row"><h3>{event.state === "published" ? t(locale, "published2") : event.state === "pending_publication" ? t(locale, "waitingApproval") : t(locale, "readySubmit")}</h3></div>
          {canSubmit && <div className="actions"><button className="btn" type="button" disabled={busy} onClick={() => run(() => submitAction(event.id, event.stateVersion))}>{busy ? t(locale, "submitting2") : t(locale, "submitApproval")}</button><span className="sub">{t(locale, "submitNeeds")}</span></div>}
          {canApprove && <div className="actions"><button className="btn" type="button" disabled={busy} onClick={() => run(() => approveAction(event.id, event.stateVersion))}>{busy ? t(locale, "publishing") : t(locale, "approvePublish")}</button></div>}
          {event.state === "pending_publication" && !canApprove && <div className="sub">{t(locale, "needApprover")}</div>}
          {event.state === "published" && <div className="sub">{t(locale, "openToSuppliers")}</div>}
        </div>
      )}

      </div>

      <div hidden={tab !== "docs"}>
      {(myRoles.includes("buyer") || tenderDocs.length > 0) && <FilePanel locale={locale} title="Tender documents" hint="Visible to invited suppliers once the event is published. Published documents can be added to, not removed." files={tenderDocs}
        canUpload={myRoles.includes("buyer") && (draft || event.state === "published")} canDelete={myRoles.includes("buyer") && draft}
        upload={(f) => uploadTenderAction(event.id, f)} remove={(id) => deleteTenderAction(event.id, id)} />}

      </div>

      <div hidden={tab !== "eval"}>
      {evalView && <EvaluationPanel locale={locale} key={`${event.state}:${event.stateVersion}`} eventId={event.id} view={evalView} />}

      {bidFiles.length > 0 && <FilePanel locale={locale} title="Bidder attachments" hint="Files bidders attached to their technical response." files={bidFiles} canUpload={false} canDelete={false} upload={async () => ({ ok: false })} remove={async () => ({ ok: false })} />}

      {clar && (clar.threads.length > 0 || clar.canAnswer) && <StaffClarifications locale={locale} eventId={event.id} threads={clar.threads} canAnswer={clar.canAnswer} open={event.state === "published"} />}

      {comView && <CommercialPanel locale={locale} key={`${event.state}:${event.stateVersion}`} eventId={event.id} view={comView} />}

      {event.state === "published" && (isAdmin || myRoles.includes("buyer")) && <InvitePanel locale={locale} eventId={event.id} suppliers={suppliers} invitations={invitations} />}

      </div>

      <div hidden={tab !== "team"}>
      <div className="card detail">
        <div className="row"><h3>{t(locale, "team")}</h3><span className="sub">{locale === "en" && teamRows.length === 1 ? "1 assignment" : t(locale, "nAssign", { n: teamRows.length })}</span></div>
        <ul className="team">
          {team.map((m) => (
            <li key={m.membershipId + m.role}><span>{m.email}</span><span className="pill">{t(locale, `role_${m.role}` as Key)}</span>
              {isAdmin && draft && <button className="btn ghost" type="button" disabled={busy} onClick={() => run(() => removeRoleAction(event.id, m.membershipId, m.role), refreshTeam)}>{t(locale, "remove")}</button>}</li>
          ))}
        </ul>
        {isAdmin && draft && (
          <form className="additem team-add" action={(fd) => run(() => assignRoleAction(event.id, String(fd.get("who")), String(fd.get("role"))), refreshTeam)}>
            <select name="who" aria-label="Person" required defaultValue="">
              <option value="" disabled>{t(locale, "choosePerson")}</option>
              {people.map((p) => <option key={p.membershipId} value={p.membershipId}>{p.email}</option>)}
            </select>
            <select name="role" aria-label="Role" defaultValue="buyer">{EVENT_ROLES.filter((r) => r !== "requester").map((r) => <option key={r} value={r}>{t(locale, `role_${r}` as Key)}</option>)}</select>
            <button className="btn" type="submit" disabled={busy}>{t(locale, "addToTeam")}</button>
          </form>
        )}
        {isAdmin && draft && <button className="btn ghost" type="button" disabled={busy} onClick={() => run(() => routeTeamAction(event.id), refreshTeam)}>{tx(locale, "Fill empty seats from approver routing")}</button>}
        {!isAdmin && draft && <div className="sub">{t(locale, "adminAssigns")}</div>}
      </div>

      </div>

      <div hidden={tab !== "items"}>
      <div className="card detail">
        <div className="row"><h3>{t(locale, "itemsToPrice")}</h3><span className="sub">{locale === "en" && view.length === 1 ? "1 item" : t(locale, "nItems", { n: view.length })}</span></div>
        {(draft || lots.length > 0) && (
          <div className="lotbox">
            <div className="sub">{tx(locale, "Lots (optional). Split the event into lots when suppliers may bid for parts of it and each part can go to a different supplier. Every item must then belong to a lot.")}</div>
            {lots.length > 0 && <ul className="lotlist">{lots.map((l) => <li key={l.id}><b>{tx(locale, "Lot {n}", { n: l.lotNo })}</b> {l.name} <span className="sub">({tx(locale, "{n} items", { n: view.filter((i) => i.lotId === l.id).length })})</span>{draft && <button className="btn ghost" type="button" onClick={() => dropLot(l.id)}>{t(locale, "remove")}</button>}</li>)}</ul>}
            {draft && <form id="addlot" action={(fd) => newLot(fd, document.getElementById("addlot") as HTMLFormElement)} className="additem"><input name="lotname" placeholder={tx(locale, "Lot name, for example Pumps")} aria-label={tx(locale, "Lot name")} required maxLength={120} /><button className="btn" type="submit">{tx(locale, "Add lot")}</button></form>}
          </div>
        )}
        {draft && sel.size > 0 && <div className="actions"><button className="btn ghost" type="button" onClick={removeSelected} style={{ color: "var(--red, #b42318)" }}>{tx(locale, "Delete {n} selected", { n: sel.size })}</button><button className="btn ghost" type="button" onClick={() => setSel(new Set())}>{tx(locale, "Clear selection")}</button></div>}
        <div className="tablewrap">
          <table className="items">
            <thead><tr>{draft && <th><input type="checkbox" aria-label={tx(locale, "Select all")} checked={view.length > 0 && sel.size === view.length} onChange={(e) => setSel(e.target.checked ? new Set(view.filter((x) => !x.pending).map((x) => x.id)) : new Set())} /></th>}<th>#</th>{lots.length > 0 && <th>{tx(locale, "Lot")}</th>}<th>{t(locale, "colDesc")}</th><th className="num">{t(locale, "colQty")}</th><th>{t(locale, "colUnit")}</th><th>{t(locale, "colPricing")}</th>{draft && <th />}</tr></thead>
            <tbody>
              {view.map((i) => (
                <tr key={i.id} className={i.pending ? "saving" : ""}>
                  {draft && <td><input type="checkbox" aria-label={tx(locale, "Select item {n}", { n: i.lineNo })} disabled={i.pending} checked={sel.has(i.id)} onChange={(e) => setSel((x) => { const n = new Set(x); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} /></td>}<td>{i.lineNo}</td>{lots.length > 0 && <td>{draft ? <select aria-label={tx(locale, "Lot")} value={i.lotId ?? ""} disabled={i.pending} onChange={(e) => setLot(i.id, e.target.value)}><option value="">{tx(locale, "No lot")}</option>{lots.map((l) => <option key={l.id} value={l.id}>{l.lotNo}. {l.name}</option>)}</select> : (lots.find((l) => l.id === i.lotId)?.name ?? "")}</td>}<td>{editCore === i.id ? <form action={(fd) => saveCore(i.id, fd)} className="additem"><input name="description" defaultValue={i.description} aria-label={t(locale, "colDesc")} required maxLength={500} /><input name="quantity" defaultValue={i.quantity} aria-label={t(locale, "colQty")} required inputMode="decimal" /><input name="unit" defaultValue={i.unit} aria-label={t(locale, "colUnit")} required maxLength={20} /><button className="btn" type="submit">{tx(locale, "Save")}</button><button className="btn ghost" type="button" onClick={() => setEditCore(null)}>{tx(locale, "Cancel")}</button></form> : <>{i.description}{draft && !i.pending && <> <button className="btn ghost" type="button" onClick={() => setEditCore(i.id)}>{tx(locale, "Edit")}</button></>}</>}{i.code && <div className="sub" dir="ltr">{i.code}</div>}{(i.materialGroup || i.requiredDate || i.specification || i.targetPrice) && <div className="sub">{[i.materialGroup, i.requiredDate && `${tx(locale, "Required by")} ${i.requiredDate}`, i.targetPrice && `${tx(locale, "Target price")} ${i.targetPrice}`].filter(Boolean).join(" · ")}{i.specification && <div style={{ whiteSpace: "pre-wrap" }}>{i.specification}</div>}</div>}{draft && !i.pending && (editing === i.id ? <form action={(fd) => saveDetails(i.id, fd)} className="additem" style={{ marginTop: 6 }}><textarea name="specification" defaultValue={i.specification ?? ""} placeholder={tx(locale, "Specification or notes for suppliers")} aria-label={tx(locale, "Specification")} maxLength={1000} rows={2} /><input name="materialGroup" defaultValue={i.materialGroup ?? ""} placeholder={tx(locale, "Material group")} aria-label={tx(locale, "Material group")} maxLength={60} /><input name="requiredDate" type="date" defaultValue={i.requiredDate ?? ""} aria-label={tx(locale, "Required by")} /><input name="targetPrice" defaultValue={i.targetPrice ?? ""} placeholder={tx(locale, "Target unit price (internal)")} aria-label={tx(locale, "Target price")} inputMode="decimal" /><button className="btn" type="submit">{tx(locale, "Save details")}</button><button className="btn ghost" type="button" onClick={() => setEditing(null)}>{tx(locale, "Cancel")}</button></form> : <button className="btn ghost" type="button" onClick={() => setEditing(i.id)}>{tx(locale, "Details")}</button>)}</td><td className="num">{Number(i.quantity).toLocaleString("en-US", { maximumFractionDigits: 3 })}</td><td>{i.unit}</td>
                  <td>{i.blockType === "LUMP_SUM" ? t(locale, "lumpSumP") : t(locale, "unitPriceP")}</td>
                  {draft && <td className="num"><button className="btn ghost" type="button" disabled={i.pending} onClick={() => remove(i.id)}>{t(locale, "remove")}</button></td>}
                </tr>
              ))}
              {view.length === 0 && <tr><td colSpan={8} className="sub">{t(locale, "noItemsYet")}{draft ? " " + t(locale, "addFirst") : ""}</td></tr>}
            </tbody>
          </table>
        </div>
        {draft && (
          <>
          <ImportItems locale={locale} eventId={event.id} />
          <form action={(fd) => add(fd, document.getElementById("additem") as HTMLFormElement)} id="additem" className="additem">
            <input name="code" list="catalog-codes" placeholder={tx(locale, "Item code (optional)")} aria-label={tx(locale, "Item code")} maxLength={40} dir="ltr" onChange={pickCode} />
            <datalist id="catalog-codes">{catalog.map((c) => <option key={c.id} value={c.code}>{c.description}</option>)}</datalist>
            <input name="description" placeholder={t(locale, "descPlaceholder")} aria-label={t(locale, "colDesc")} required maxLength={500} />
            <input name="quantity" placeholder={t(locale, "qtyPlaceholder")} aria-label={t(locale, "colQty")} required inputMode="decimal" pattern="\d{1,15}(\.\d{1,3})?" title="A positive number, up to 3 decimals" />
            <input name="unit" placeholder={t(locale, "colUnit")} aria-label={t(locale, "colUnit")} required maxLength={20} defaultValue="EA" />
            {lots.length > 0 && <select name="lot" aria-label={tx(locale, "Lot")} defaultValue=""><option value="">{tx(locale, "No lot")}</option>{lots.map((l) => <option key={l.id} value={l.id}>{l.lotNo}. {l.name}</option>)}</select>}
            <button className="btn" type="submit">{t(locale, "addItem")}</button>
          </form>
          </>
        )}
      </div>
      </div>

      <div hidden={tab !== "activity"}>
        <div className="card detail">
          <div className="row"><h3>{tx(locale, "Activity")}</h3></div>
          {activity.length === 0 ? <div className="sub">{tx(locale, "No activity yet.")}</div> : (
            <ul className="team">{activity.map((a, i) => <li key={i}><span>{a.action.replace(/[._]/g, " ")}</span><span className="sub">{a.actor} · {new Date(a.at).toLocaleString(locale === "ar" ? "ar" : "en-GB")}</span></li>)}</ul>)}
        </div>
      </div>
    </>
  );
}
