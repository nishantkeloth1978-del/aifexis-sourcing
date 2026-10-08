"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { lab } from "./lab";
import type { EventTemplateInfo } from "@/templates/events";
import type { InputRow } from "@/templates/schedule";
import { saveInputsAction } from "../../app/templates/actions";

export default function TemplateInputsPanel({ locale, eventId, info, editable }: { locale: Locale; eventId: string; info: EventTemplateInfo; editable: boolean }) {
  const router = useRouter();
  const e = info.effective;
  const [groups, setGroups] = useState<Record<string, InputRow[]>>(info.inputs.groups);
  const [include, setInclude] = useState<string[]>(info.inputs.include ?? []);
  const [values, setValues] = useState<Record<string, unknown>>(info.values);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [incomplete, setIncomplete] = useState(info.schedule.incomplete);
  const [lines, setLines] = useState(info.schedule.items.length);
  const dis = !editable || info.frozen;

  const setCell = (g: string, i: number, k: string, v: string) => setGroups((x) => ({ ...x, [g]: (x[g] ?? []).map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const addRow = (g: string) => setGroups((x) => ({ ...x, [g]: [...(x[g] ?? []), {}] }));
  const delRow = (g: string, i: number) => setGroups((x) => ({ ...x, [g]: (x[g] ?? []).filter((_, j) => j !== i) }));
  async function save() {
    setMsg(null);
    const r = await saveInputsAction(eventId, { groups, include }, values);
    if (!r.ok) { setMsg({ ok: false, text: tx(locale, r.error) }); return; }
    setIncomplete(r.schedule.incomplete); setLines(r.schedule.items.length);
    setMsg({ ok: true, text: tx(locale, "Saved. {n} lines are in the price schedule.", { n: r.schedule.items.length }) });
    router.refresh();
  }
  const optional = e.pricing.lines.filter((l) => l.optional);
  const buyerFields = e.fields.filter((f) => f.source === "buyer");
  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Template inputs")}</h3><span className="sub">{info.key} v{info.version}</span></div>
      <div className={incomplete ? "alert" : "okbox"}>{incomplete ? tx(locale, "Complete the template inputs (sites, quantities and days) before submitting.") : tx(locale, "Template inputs are complete.")} <span className="sub">({tx(locale, "{n} lines", { n: lines })})</span></div>
      {msg && <div className={msg.ok ? "okbox" : "alert"} role="status">{msg.text}</div>}
      {buyerFields.length > 0 && <>
        <h3>{tx(locale, "Event requirements")}</h3>
        {buyerFields.map((f) => (
          <label key={f.key}>{lab(f.label, locale)}{f.required === true ? " *" : ""}
            {f.type === "longtext" ? <textarea rows={3} disabled={dis} value={String(values[f.key] ?? "")} onChange={(ev) => setValues((v) => ({ ...v, [f.key]: ev.target.value }))} />
              : f.type === "single" ? <select disabled={dis} value={String(values[f.key] ?? "")} onChange={(ev) => setValues((v) => ({ ...v, [f.key]: ev.target.value }))}><option value="">{tx(locale, "Choose…")}</option>{f.options?.map((o) => <option key={o.key} value={o.key}>{lab(o.label, locale)}</option>)}</select>
              : f.type === "boolean" ? <input type="checkbox" disabled={dis} checked={values[f.key] === true} onChange={(ev) => setValues((v) => ({ ...v, [f.key]: ev.target.checked }))} />
              : <input disabled={dis} type={f.type === "date" ? "date" : "text"} inputMode={f.type === "integer" || f.type === "decimal" || f.type === "money" ? "decimal" : undefined} value={String(values[f.key] ?? "")} onChange={(ev) => setValues((v) => ({ ...v, [f.key]: ev.target.value }))} />}
            {f.help && <span className="sub">{lab(f.help, locale)}</span>}</label>
        ))}</>}
      {e.pricing.groups.map((g) => (
        <div key={g.key}>
          <h3>{lab(g.label, locale)}</h3>
          <div className="tablewrap"><table className="items"><thead><tr>{g.inputs.map((i) => <th key={i.key}>{lab(i.label, locale)}{i.required ? " *" : ""}</th>)}<th /></tr></thead><tbody>
            {(groups[g.key] ?? []).map((r, i) => (
              <tr key={i}>{g.inputs.map((inp) => <td key={inp.key}><input className="priceinput" disabled={dis} aria-label={lab(inp.label, locale)} inputMode={inp.type === "text" ? undefined : "decimal"} value={String(r[inp.key] ?? (inp.default ?? ""))} onChange={(ev) => setCell(g.key, i, inp.key, ev.target.value)} /></td>)}
                <td>{!dis && g.repeat && <button type="button" className="btn ghost" onClick={() => delRow(g.key, i)}>{tx(locale, "Remove")}</button>}</td></tr>
            ))}
          </tbody></table></div>
          {!dis && (g.repeat || (groups[g.key] ?? []).length === 0) && <div className="actions"><button type="button" className="btn ghost" onClick={() => addRow(g.key)}>{tx(locale, "Add row")}</button></div>}
        </div>
      ))}
      {optional.length > 0 && <><h3>{tx(locale, "Optional lines")}</h3>
        {optional.map((l) => <label key={l.key}><input type="checkbox" disabled={dis} checked={include.includes(l.key)} onChange={() => setInclude((x) => (x.includes(l.key) ? x.filter((k) => k !== l.key) : [...x, l.key]))} /> {lab(l.description, locale).replace(/\{name\}/g, "").trim()}</label>)}</>}
      {!dis && <div className="actions"><button className="btn" type="button" onClick={save}>{tx(locale, "Save inputs")}</button></div>}
      {info.frozen && <div className="sub">{tx(locale, "The template configuration was frozen when the event was submitted.")}</div>}
    </div>
  );
}
