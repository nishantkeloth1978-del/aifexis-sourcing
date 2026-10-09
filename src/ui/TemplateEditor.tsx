"use client";
import Link from "next/link";
import { ARABIC_ENABLED } from "@/i18n/flag";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { lab } from "./lab";
import type { CustomMeta } from "@/templates/custom";
import type { Category } from "@/templates/service";
import type { TemplateContent } from "@/templates/types";
import { checkTemplateAction, draftTemplateAction, exportSheetAction, importTemplateAction, previewSheetAction, type SheetPreview } from "../../app/templates/actions";

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Kind = "key" | "L" | "text" | "select" | "check" | "cond" | "options" | "csv" | "objects" | "scalar";
interface Spec { k: string; kind: Kind; label: string; options?: [string, string][]; sub?: Spec[]; make?: () => Obj; hint?: string }
const L0 = () => ({ en: "", ar: "" });
const OPT: Spec[] = [{ k: "key", kind: "key", label: "Key" }, { k: "label", kind: "L", label: "Label" }];
const SECTION_HINT = "general, technical, commercial, equipment, service, warranty, mobilisation";

const FIELD: Spec[] = [
  { k: "key", kind: "key", label: "Key" }, { k: "label", kind: "L", label: "Label" },
  { k: "type", kind: "select", label: "Answer type", options: [["text", "Short text"], ["longtext", "Long text"], ["integer", "Whole number"], ["decimal", "Decimal number"], ["money", "Amount"], ["date", "Date"], ["boolean", "Yes / No"], ["single", "Choose one"], ["multi", "Choose several"]] },
  { k: "source", kind: "select", label: "Who fills it in", options: [["supplier", "Supplier"], ["buyer", "Buyer"]] },
  { k: "envelope", kind: "select", label: "Envelope", options: [["technical", "Technical"], ["commercial", "Commercial"]] },
  { k: "section", kind: "key", label: "Section", hint: SECTION_HINT },
  { k: "required", kind: "cond", label: "Required" }, { k: "visible", kind: "text", label: "Show only when (condition)" },
  { k: "options", kind: "options", label: "Choices", sub: OPT }, { k: "help", kind: "L", label: "Help text" },
];
const QUESTION: Spec[] = [
  { k: "key", kind: "key", label: "Key" }, { k: "label", kind: "L", label: "Question" },
  { k: "type", kind: "select", label: "Answer type", options: [["text", "Text"], ["yesno", "Yes / No"], ["single", "Choose one"], ["multi", "Choose several"], ["number", "Number"], ["date", "Date"]] },
  { k: "use", kind: "select", label: "Used for", options: [["info", "Information"], ["scoring", "Scored by evaluators"], ["qualification", "Pass / fail qualification"]] },
  { k: "section", kind: "key", label: "Section", hint: SECTION_HINT }, { k: "required", kind: "cond", label: "Required" }, { k: "options", kind: "options", label: "Choices", sub: OPT },
];
const DOC: Spec[] = [
  { k: "key", kind: "key", label: "Key" }, { k: "label", kind: "L", label: "Document" }, { k: "purpose", kind: "L", label: "Why it is needed" },
  { k: "envelope", kind: "select", label: "Envelope", options: [["technical", "Technical"], ["commercial", "Commercial"]] }, { k: "required", kind: "cond", label: "Required" }, { k: "fileTypes", kind: "csv", label: "File types (comma separated)" },
];
const INPUT: Spec[] = [
  { k: "key", kind: "key", label: "Key" }, { k: "label", kind: "L", label: "Label" },
  { k: "type", kind: "select", label: "Type", options: [["integer", "Whole number"], ["decimal", "Decimal number"], ["text", "Text"], ["boolean", "Yes / No"]] },
  { k: "required", kind: "check", label: "Required" }, { k: "default", kind: "scalar", label: "Default value" },
];
const GROUP: Spec[] = [{ k: "key", kind: "key", label: "Key" }, { k: "label", kind: "L", label: "Group (for example a site or a role)" }, { k: "repeat", kind: "check", label: "The buyer can add several rows" }, { k: "inputs", kind: "objects", label: "Inputs the buyer enters", sub: INPUT, make: () => ({ key: "", label: L0(), type: "integer", required: true }) }];
const LINE: Spec[] = [
  { k: "key", kind: "key", label: "Key" }, { k: "description", kind: "L", label: "Description (use {name} for the row name)" },
  { k: "group", kind: "key", label: "Group key (blank = one line)" }, { k: "quantity", kind: "text", label: "Quantity formula, for example headcount * days" }, { k: "unit", kind: "text", label: "Unit" },
  { k: "block", kind: "select", label: "Price type", options: [["UNIT_PRICE", "Unit price"], ["LUMP_SUM", "Lump sum"]] }, { k: "when", kind: "text", label: "Include only when (condition)" }, { k: "optional", kind: "check", label: "Optional: the buyer chooses to include it" },
];
const CRIT: Spec[] = [{ k: "key", kind: "key", label: "Key" }, { k: "label", kind: "L", label: "Criterion" }];

const TABS = ["Fields", "Questions", "Documents", "Pricing", "Evaluation"] as const;
type Tab = (typeof TABS)[number];

function Value({ s, v, set, locale }: { s: Spec; v: any; set: (x: any) => void; locale: Locale }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const lbl = tx(locale, s.label);
  switch (s.kind) {
    case "key": return <label>{lbl}{s.hint && <span className="sub"> ({s.hint})</span>}<input value={v ?? ""} maxLength={80} onChange={(e) => set(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} /></label>;
    case "text": return <label>{lbl}<input value={v ?? ""} maxLength={300} onChange={(e) => set(e.target.value || undefined)} /></label>;
    case "scalar": return <label>{lbl}<input value={v === undefined ? "" : String(v)} onChange={(e) => { const t = e.target.value; set(t === "" ? undefined : /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t === "true" ? true : t === "false" ? false : t); }} /></label>;
    case "L": return <fieldset className="lset"><legend>{lbl}</legend><input aria-label={`${lbl} English`} placeholder="English" value={v?.en ?? ""} maxLength={400} onChange={(e) => set({ ...(v ?? L0()), en: e.target.value, ...(ARABIC_ENABLED || (v?.ar && v.ar !== v.en) ? {} : { ar: e.target.value }) })} />{ARABIC_ENABLED && <input aria-label={`${lbl} العربية`} placeholder="العربية" dir="rtl" value={v?.ar ?? ""} maxLength={400} onChange={(e) => set({ ...(v ?? L0()), ar: e.target.value })} />}</fieldset>;
    case "select": return <label>{lbl}<select value={v ?? ""} onChange={(e) => set(e.target.value)}>{s.options!.map(([val, en]) => <option key={val} value={val}>{tx(locale, en)}</option>)}</select></label>;
    case "check": return <label><input type="checkbox" checked={v === true} onChange={(e) => set(e.target.checked ? true : undefined)} /> {lbl}</label>;
    case "cond": { const mode = typeof v === "string" ? "cond" : v === true ? "yes" : "no"; return <label>{lbl}<span>
      <select value={mode} onChange={(e) => set(e.target.value === "yes" ? true : e.target.value === "no" ? false : "")}><option value="no">{tx(locale, "No")}</option><option value="yes">{tx(locale, "Yes")}</option><option value="cond">{tx(locale, "Only when…")}</option></select>
      {mode === "cond" && <input aria-label={tx(locale, "Condition")} placeholder={'spec_compliance != "compliant"'} value={v} maxLength={300} onChange={(e) => set(e.target.value)} />}</span></label>; }
    case "csv": return <label>{lbl}<input value={(v ?? []).join(", ")} onChange={(e) => set(e.target.value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))} /></label>;
    case "options": case "objects": return <fieldset className="lset"><legend>{lbl}</legend>
      {(v ?? []).map((o: Obj, i: number) => <div className="subrow" key={i}><ObjectForm spec={s.sub!} obj={o} set={(n) => set((v ?? []).map((x: Obj, j: number) => (j === i ? n : x)))} locale={locale} /><button type="button" className="btn ghost" onClick={() => set((v ?? []).filter((_: Obj, j: number) => j !== i))}>{tx(locale, "Remove")}</button></div>)}
      <button type="button" className="btn ghost" onClick={() => set([...(v ?? []), (s.make ?? (() => ({ key: "", label: L0() })))()])}>{tx(locale, "Add")}</button></fieldset>;
  }
}
function ObjectForm({ spec, obj, set, locale }: { spec: Spec[]; obj: Obj; set: (o: Obj) => void; locale: Locale }) {
  return <div className="objform">{spec.map((s) => <Value key={s.k} s={s} v={obj[s.k]} set={(x) => { const n = { ...obj }; if (x === undefined || (Array.isArray(x) && x.length === 0 && s.kind === "options")) delete n[s.k]; else n[s.k] = x; set(n); }} locale={locale} />)}</div>;
}

/** A list whose items can be dragged (or moved with the arrow buttons), selected, edited, added and removed. */
function Sortable({ items, setItems, spec, make, titleOf, locale, flagged }: { items: Obj[]; setItems: (x: Obj[]) => void; spec: Spec[]; make: () => Obj; titleOf: (o: Obj) => string; locale: Locale; flagged: Set<string> }) {
  const [sel, setSel] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const move = (from: number, to: number) => { if (to < 0 || to >= items.length || from === to) return; const a = [...items]; const [x] = a.splice(from, 1); a.splice(to, 0, x!); setItems(a); setSel(to); };
  return (
    <div className="editor-cols">
      <ul className="sortlist" aria-label={tx(locale, "Items")}>
        {items.map((o, i) => (
          <li key={i} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }}
            className={`${sel === i ? "sel" : ""} ${flagged.has(o.key) ? "flag" : ""}`}>
            <span className="grip" aria-hidden>⠿</span>
            <button type="button" className="linkbtn" onClick={() => setSel(i)}>{titleOf(o) || o.key || tx(locale, "(new)")}</button>
            <span className="sub">{o.key}</span>
            <button type="button" className="btn ghost" aria-label={tx(locale, "Move up")} onClick={() => move(i, i - 1)} disabled={i === 0}>▲</button>
            <button type="button" className="btn ghost" aria-label={tx(locale, "Move down")} onClick={() => move(i, i + 1)} disabled={i === items.length - 1}>▼</button>
          </li>))}
        <li><button type="button" className="btn" onClick={() => { setItems([...items, make()]); setSel(items.length); }}>{tx(locale, "Add item")}</button></li>
      </ul>
      <div className="editpane">
        {sel !== null && items[sel] ? <>
          <ObjectForm spec={spec} obj={items[sel]!} set={(n) => setItems(items.map((x, j) => (j === sel ? n : x)))} locale={locale} />
          <div className="actions"><button type="button" className="btn ghost" onClick={() => { setItems(items.filter((_, j) => j !== sel)); setSel(null); }}>{tx(locale, "Delete this item")}</button></div>
        </> : <div className="sub">{tx(locale, "Select an item to edit it, or drag items to change their order.")}</div>}
      </div>
    </div>
  );
}

export default function TemplateEditor({ locale, initial, categories, canEdit, aiOn = false }: { aiOn?: boolean; locale: Locale; initial: { meta: CustomMeta; content: TemplateContent; own: boolean; version: number }; categories: Category[]; canEdit: boolean }) {
  const router = useRouter();
  const [c, setC] = useState<TemplateContent>(() => JSON.parse(JSON.stringify(initial.content)));
  const [meta, setMeta] = useState<CustomMeta>(() => (initial.own ? initial.meta : { ...initial.meta, key: initial.meta.key.startsWith("CO_") ? initial.meta.key : `CO_${initial.meta.key}`.slice(0, 64) }));
  const [tab, setTab] = useState<Tab>("Fields");
  const [issues, setIssues] = useState<{ key: string; message: string; remediation?: string }[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [prev, setPrev] = useState<SheetPreview | null>(null);
  const [brief, setBrief] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  async function draft() {
    if (c.fields.length + c.questions.length + c.documents.length + c.pricing.lines.length > 0 && !window.confirm(tx(locale, "This replaces what is in the editor with an AI draft. Continue?"))) return;
    setDrafting(true); setMsg(null);
    const r = await draftTemplateAction(brief).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setDrafting(false);
    if (!r.ok) { setMsg({ ok: false, text: tx(locale, r.error) }); return; }
    setC(r.content); setMeta((m) => ({ ...m, ...r.meta, key: initial.own ? m.key : r.meta.key }));
    setIssues(r.problems.length ? r.problems.map((p) => ({ key: p.where, message: p.message })) : null);
    setAiNote(tx(locale, r.note)); setTab("Fields");
  }
  const file = useRef<HTMLInputElement>(null);
  const flagged = useMemo(() => new Set((issues ?? []).map((i) => i.key.split(":").pop() ?? "")), [issues]);
  const set = <K extends keyof TemplateContent>(k: K, v: TemplateContent[K]) => { setC((x) => ({ ...x, [k]: v })); setIssues(null); };
  const pricing = (p: Partial<TemplateContent["pricing"]>) => set("pricing", { ...c.pricing, ...p });
  const evaluation = (p: Partial<TemplateContent["evaluation"]>) => set("evaluation", { ...c.evaluation, ...p });

  async function check() { const r = await checkTemplateAction(c); setIssues(r.issues); setMsg(r.ok ? { ok: true, text: tx(locale, "No problems found.") } : null); return r.ok; }
  async function save() {
    setMsg(null);
    if (!(await check())) return;
    const r = await importTemplateAction(meta, JSON.stringify(c));
    if (!r.ok) { setMsg({ ok: false, text: tx(locale, r.error) }); return; }
    setMsg({ ok: true, text: tx(locale, "Saved as {0} (version {n}). Enable it in the list below.", { 0: r.key, n: r.version }) });
    router.refresh();
  }
  async function download() {
    const r = await exportSheetAction(meta, c);
    if (!r.ok) { setMsg({ ok: false, text: tx(locale, r.error) }); await check(); return; }
    const a = document.createElement("a"); a.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${r.base64}`; a.download = `${meta.key || "template"}.xlsx`; a.click();
  }
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    const fd = new FormData(); fd.set("file", f);
    const r = await previewSheetAction(fd).catch(() => ({ ok: false as const, error: "That file could not be read." }));
    if (!r.ok) { setMsg({ ok: false, text: tx(locale, r.error) }); return; }
    setMsg(null); setPrev(r.preview);
  }
  function useSheet() { if (!prev?.content) return; setC(prev.content); setMeta((m) => ({ ...m, ...prev.meta, title: { en: prev.meta.title?.en ?? m.title.en, ar: prev.meta.title?.ar ?? m.title.ar } } as CustomMeta)); setPrev(null); setIssues(null); setMsg({ ok: true, text: tx(locale, "Spreadsheet loaded. Review it and save.") }); }

  const firstGroupKeys = c.pricing.groups.map((g) => g.key).join(", ");
  return (
    <div className="setup">
      <div className="card detail">
        <div className="row"><h3>{tx(locale, "Template details")}</h3><Link className="btn ghost" href="/templates">{tx(locale, "Templates")}</Link></div>
        {!initial.own && <div className="sub">{tx(locale, "This is a platform template. Saving creates your own copy under a new key.")}</div>}
        {canEdit && aiOn && <fieldset className="lset"><legend>{tx(locale, "Draft with AI")}</legend>
          <textarea rows={3} maxLength={2000} value={brief} placeholder={tx(locale, "Describe what you are buying, who supplies it and what you need to compare.")} onChange={(e) => setBrief(e.target.value)} />
          <div className="actions"><button type="button" className="btn" disabled={drafting || brief.trim().length < 20} onClick={draft}>{drafting ? tx(locale, "Drafting…") : tx(locale, "Draft template")}</button></div>
          <div className="sub">{tx(locale, "The draft is only a starting point. Nothing is saved until you review it, run Check and save it.")}</div></fieldset>}
        {aiNote && <div className="alert" role="status">{aiNote}</div>}
        <label>{tx(locale, "Template key")}<input value={meta.key} disabled={initial.own} maxLength={64} onChange={(e) => setMeta({ ...meta, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} /></label>
        <fieldset className="lset"><legend>{tx(locale, "Name")}</legend><input placeholder="English" value={meta.title.en} maxLength={160} onChange={(e) => setMeta({ ...meta, title: { ...meta.title, en: e.target.value, ...(ARABIC_ENABLED || (meta.title.ar && meta.title.ar !== meta.title.en) ? {} : { ar: e.target.value }) } })} />{ARABIC_ENABLED && <input placeholder="العربية" dir="rtl" value={meta.title.ar} maxLength={160} onChange={(e) => setMeta({ ...meta, title: { ...meta.title, ar: e.target.value } })} />}</fieldset>
        <label>{tx(locale, "Category")}<select value={meta.category} onChange={(e) => setMeta({ ...meta, category: e.target.value })}>{categories.map((x) => <option key={x.code} value={x.code}>{lab(x, locale)}</option>)}</select></label>
        <label>{tx(locale, "Event type")}<select value={meta.eventType} onChange={(e) => setMeta({ ...meta, eventType: e.target.value as CustomMeta["eventType"] })}><option>RFI</option><option>RFQ</option><option>RFP</option></select></label>
      </div>

      <div className="card"><div className="tabs" role="tablist">{TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "btn" : "btn ghost"} onClick={() => setTab(t)}>{tx(locale, t)}</button>)}</div></div>

      <div className="card detail">
        {tab === "Fields" && <Sortable items={c.fields as Obj[]} setItems={(x) => set("fields", x as never)} spec={FIELD} titleOf={(o) => lab(o.label ?? L0(), locale)} make={() => ({ key: "", section: "general", label: L0(), type: "text", source: "supplier", envelope: "technical", required: false })} locale={locale} flagged={flagged} />}
        {tab === "Questions" && <Sortable items={c.questions as Obj[]} setItems={(x) => set("questions", x as never)} spec={QUESTION} titleOf={(o) => lab(o.label ?? L0(), locale)} make={() => ({ key: "", section: "technical", label: L0(), type: "text", use: "info", required: false })} locale={locale} flagged={flagged} />}
        {tab === "Documents" && <Sortable items={c.documents as Obj[]} setItems={(x) => set("documents", x as never)} spec={DOC} titleOf={(o) => lab(o.label ?? L0(), locale)} make={() => ({ key: "", label: L0(), purpose: L0(), required: false, origin: "company", envelope: "technical", fileTypes: ["pdf"] })} locale={locale} flagged={flagged} />}
        {tab === "Pricing" && <>
          <label>{tx(locale, "Pricing model")}<select value={c.pricing.model} onChange={(e) => pricing({ model: e.target.value as never })}>{[["itemized", "Itemised quantities"], ["person_day", "Person-days"], ["manpower", "Manpower per month"], ["subscription", "Subscription"], ["milestone", "Milestones"], ["freight", "Freight lanes"], ["mixed", "Mixed"], ["none", "No prices (RFI)"]].map(([v, l]) => <option key={v} value={v}>{tx(locale, l!)}</option>)}</select></label>
          <h3>{tx(locale, "Groups the buyer fills in")}</h3>
          <Sortable items={c.pricing.groups as Obj[]} setItems={(x) => pricing({ groups: x as never })} spec={GROUP} titleOf={(o) => lab(o.label ?? L0(), locale)} make={() => ({ key: "", label: L0(), repeat: true, inputs: [] })} locale={locale} flagged={flagged} />
          <h3>{tx(locale, "Price lines suppliers quote")}</h3>
          {firstGroupKeys && <div className="sub">{tx(locale, "Group keys")}: {firstGroupKeys}</div>}
          <Sortable items={c.pricing.lines as Obj[]} setItems={(x) => pricing({ lines: x as never })} spec={LINE} titleOf={(o) => lab(o.description ?? L0(), locale)} make={() => ({ key: "", description: L0(), quantity: "1", unit: "EA", block: "UNIT_PRICE" })} locale={locale} flagged={flagged} />
        </>}
        {tab === "Evaluation" && <>
          <label>{tx(locale, "Default evaluation mode")}<select value={c.evaluation.mode} onChange={(e) => evaluation({ mode: e.target.value as never })}>{[["price", "Lowest price"], ["weighted", "Weighted score"], ["qualification", "Pass / fail"], ["manual", "Manual"]].map(([v, l]) => <option key={v} value={v}>{tx(locale, l!)}</option>)}</select></label>
          <fieldset className="lset"><legend>{tx(locale, "Modes the buyer may choose")}</legend>{[["price", "Lowest price"], ["weighted", "Weighted score"], ["qualification", "Pass / fail"], ["manual", "Manual"]].map(([v, l]) => <label key={v}><input type="checkbox" checked={c.evaluation.modes.includes(v as never)} onChange={(e) => evaluation({ modes: e.target.checked ? [...c.evaluation.modes, v as never] : c.evaluation.modes.filter((m) => m !== v) })} /> {tx(locale, l!)}</label>)}</fieldset>
          <h3>{tx(locale, "Scoring criteria")}</h3>
          <Sortable items={c.evaluation.criteria as Obj[]} setItems={(x) => evaluation({ criteria: x as never })} spec={CRIT} titleOf={(o) => lab(o.label ?? L0(), locale)} make={() => ({ key: "", label: L0() })} locale={locale} flagged={flagged} />
          <div className="sub">{tx(locale, "Weights and approval thresholds stay with the company, never with a template.")}</div>
        </>}
      </div>

      {issues && issues.length > 0 && <div className="alert" role="alert"><b>{tx(locale, "Fix these before saving")}</b><ul className="errlist">{issues.map((i, k) => <li key={k}>{tx(locale, i.message)}{i.remediation ? ` ${tx(locale, i.remediation)}` : ""}</li>)}</ul></div>}
      {msg && <div className={msg.ok ? "okbox" : "alert"} role="status">{msg.text}</div>}
      {prev && <div className="card detail"><h3>{tx(locale, "Spreadsheet preview")}</h3>
        <div className="sub">{tx(locale, "{n} fields, {q} questions, {d} documents, {g} groups, {l} price lines", { n: prev.counts.fields ?? 0, q: prev.counts.questions ?? 0, d: prev.counts.documents ?? 0, g: prev.counts.groups ?? 0, l: prev.counts.lines ?? 0 })}</div>
        {prev.problems.length > 0 ? <ul className="errlist">{prev.problems.map((p, i) => <li key={i}><b>{p.where}</b>: {tx(locale, p.message)}</li>)}</ul> : <div className="okbox">{tx(locale, "No problems found.")}</div>}
        <div className="actions"><button type="button" className="btn" disabled={!prev.content} onClick={useSheet}>{tx(locale, "Use this spreadsheet")}</button><button type="button" className="btn ghost" onClick={() => setPrev(null)}>{tx(locale, "Cancel")}</button></div></div>}

      <div className="card"><div className="actions">
        <button type="button" className="btn ghost" onClick={check}>{tx(locale, "Check")}</button>
        {canEdit && <button type="button" className="btn" disabled={!meta.key.startsWith("CO_") || !meta.title.en.trim() || (ARABIC_ENABLED && !meta.title.ar.trim())} onClick={save}>{tx(locale, "Save as new version")}</button>}
        <button type="button" className="btn ghost" onClick={download}>{tx(locale, "Download as Excel")}</button>
        <input ref={file} type="file" accept=".xlsx" hidden onChange={pick} />
        <button type="button" className="btn ghost" onClick={() => file.current?.click()}>{tx(locale, "Upload Excel")}</button>
      </div></div>
    </div>
  );
}
