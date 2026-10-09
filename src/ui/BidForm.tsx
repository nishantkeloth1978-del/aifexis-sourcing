"use client";
import HelpTip from "./HelpTip";
import ClosingClock from "./ClosingClock";
import { useMemo, useRef, useState } from "react";
import { formatDec, parseDec, rescale } from "@/engine/decimal";
import type { BidForm as Form } from "@/bids/service";
import { tx } from "@/i18n/tx";
import { isRequired, isVisible, type Answers } from "@/templates/response";
import { dateLocale, t, type Locale } from "@/i18n/dict";
import { lab } from "./lab";
import { applyTiers, MAX_TIERS, type Tier } from "@/boq/tiers";
import { headersFor, rollup } from "@/boq/sections";
import { importPricesAction, submitBidAction } from "../../app/supplier/events/[id]/actions";

export default function BidForm({ form, locale = "en" }: { form: Form; locale?: Locale }) {
  const [prices, setPrices] = useState<Record<string, string>>(form.prices);
  const [text, setText] = useState(form.technicalText);
  const [revision, setRevision] = useState(form.revisionNo);
  const [saved, setSaved] = useState<string | null>(form.total);
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [gates, setGates] = useState<Record<string, boolean>>(form.gateAnswers);
  const [tiers, setTiers] = useState<Record<string, Tier[]>>(form.tiers ?? {});
  const [tierOpen, setTierOpen] = useState<string | null>(null);
  const [alts, setAlts] = useState<{ label: string; note: string; prices: Record<string, string> }[]>(form.alternates ?? []);
  const [bundles, setBundles] = useState<{ lotIds: string[]; discountPct: string }[]>(form.bundles ?? []);
  const [ans, setAns] = useState<Answers>(form.answers ?? {});
  const [sheetMsg, setSheetMsg] = useState<{ ok: boolean; text: string; errors?: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const key = useRef(crypto.randomUUID());

  // The total updates as you type. The server recalculates it from the prices on submit.
  const lotted = form.lots.length > 0;
  const amountOf = (it: Form["items"][number]) => {
    if (it.zeroOk && (prices[it.id] ?? "") === "NB") return 0n;
    const p = parseDec(prices[it.id] ?? "", 4); if (p === null || (p === 0n && !it.zeroOk)) return null;
    const q = parseDec(it.quantity, 3) ?? 0n;
    if (it.blockType !== "LUMP_SUM" && (tiers[it.id] ?? []).some((t) => t.minQty || t.unitPrice)) {
      const ck = applyTiers(prices[it.id] ?? "", tiers[it.id], it.quantity, it.lineNo);
      return ck.ok ? rescale(ck.effective * q, 7, 2) : null;
    }
    return it.blockType === "LUMP_SUM" ? rescale(p, 4, 2) : rescale(p * q, 7, 2);
  };
  const altTotal = (a: { prices: Record<string, string> }): bigint | null => {
    let t = 0n;
    for (const it of form.items) {
      const p = parseDec(a.prices[it.id] ?? "", 4); if (p === null || (p === 0n && !it.zeroOk)) return null;
      const q = parseDec(it.quantity, 3) ?? 0n;
      t += it.blockType === "LUMP_SUM" ? rescale(p, 4, 2) : rescale(p * q, 7, 2);
    }
    return t;
  };
  // Per lot: "empty" (no bid), "full" (every line priced, with its total) or "partial" (not allowed).
  const lotState = useMemo((): { lot: Form["lots"][number]; status: "empty" | "full" | "partial"; total: bigint }[] => form.lots.map((lot) => {
    const its = form.items.filter((i) => i.lotId === lot.id);
    const filled = its.filter((i) => (prices[i.id] ?? "").trim() !== "");
    if (!filled.length) return { lot, status: "empty" as const, total: 0n };
    const amts = its.map((i) => amountOf(i));
    if (amts.some((a) => a === null)) return { lot, status: "partial" as const, total: 0n };
    return { lot, status: "full" as const, total: amts.reduce<bigint>((a, b) => a + (b ?? 0n), 0n) };
  }), [prices, form.items, form.lots]);  // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => {
    if (lotted) {
      if (lotState.some((l) => l.status === "partial") || !lotState.some((l) => l.status === "full")) return null;
      return lotState.reduce<bigint>((a, l) => a + l.total, 0n);
    }
    let t = 0n;
    for (const it of form.items) { const a = amountOf(it); if (a === null) return null; t += a; }
    return t;
  }, [prices, form.items, lotted, lotState]);  // eslint-disable-line react-hooks/exhaustive-deps

  type BRow = { kind: "lot"; lot: Form["lots"][number] } | { kind: "sec"; path: string; label: string; depth: number; total: bigint } | { kind: "item"; it: Form["items"][number] };
  const itemRows = (its: Form["items"]): BRow[] => {
    const hs = headersFor(its.map((i) => i.section ?? null));
    const roll = rollup(its.map((i) => ({ section: i.section ?? null, amount: amountOf(i) ?? 0n })));
    const out: BRow[] = [];
    its.forEach((it, idx) => { for (const h of hs.filter((x) => x.at === idx)) out.push({ kind: "sec", path: h.path, label: h.label, depth: h.depth, total: roll.sections.find((x) => x.path === h.path)?.total ?? 0n }); out.push({ kind: "item", it }); });
    return out;
  };
  const rowsAll: BRow[] = lotted ? form.lots.flatMap((lot) => [{ kind: "lot" as const, lot }, ...itemRows(form.items.filter((i) => i.lotId === lot.id))]) : itemRows(form.items);
  const dirty = saved === null || JSON.stringify(prices) !== JSON.stringify(form.prices) || JSON.stringify(tiers) !== JSON.stringify(form.tiers ?? {}) || JSON.stringify(alts) !== JSON.stringify(form.alternates ?? []) || JSON.stringify(bundles) !== JSON.stringify(form.bundles ?? []) || JSON.stringify(gates) !== JSON.stringify(form.gateAnswers) || JSON.stringify(ans) !== JSON.stringify(form.answers ?? {}) || text !== form.technicalText || revision !== form.revisionNo;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (form.questionnaire) for (const a of form.questionnaire.asks) {
      const v = ans[a.key]; const empty = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
      if (empty && isVisible(a, ans) && isRequired(a, ans)) { setError(tx(locale, "Answer: {0}.", { 0: lab(a.label, locale) })); return; }
    }
    if (form.questionnaire) for (const d of form.questionnaire.documents) {
      if (isRequired({ key: d.key, label: d.label, type: "text", envelope: d.envelope, required: d.required, section: "general" }, ans) && !((form.docFiles[d.key] ?? 0) > 0)) { setError(tx(locale, "Attach the required document: {0}.", { 0: lab(d.label, locale) })); return; }
    }
    setState("sending");
    const res = await submitBidAction(form.event.id, { prices, tiers, alternates: alts, bundles, technicalText: text, gates, answers: form.questionnaire ? ans : undefined, idempotencyKey: key.current }).catch(() => ({ ok: false as const, error: "That could not be submitted. Try again." }));
    setState("idle");
    if (!res.ok) { setError(res.error); return; }
    setRevision(res.revisionNo); setSaved(res.total); key.current = crypto.randomUUID();
  }
  async function pickSheet(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setSheetMsg(null);
    const fd = new FormData(); fd.set("file", f);
    const r = await importPricesAction(form.event.id, fd).catch(() => ({ ok: false as const, error: "That file could not be read." }));
    if (!r.ok) { setSheetMsg({ ok: false, text: r.error }); return; }
    setPrices((p) => ({ ...p, ...r.prices }));
    setSheetMsg({ ok: r.errors.length === 0, text: t(locale, "pricesLoaded", { n: r.filled }), errors: r.errors.slice(0, 6).map((x) => `Row ${x.row}: ${x.message}`) });
  }
  const closes = form.event.closesAt ? new Date(form.event.closesAt).toLocaleString(dateLocale(locale), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: form.event.timeZone || "UTC", timeZoneName: "short" }) : t(locale, "noClosing");
  const cur = form.event.currency;
  const changedCount = Object.keys({ ...form.prices, ...prices }).filter((k) => (form.prices[k] ?? "") !== (prices[k] ?? "")).length;

  return (
    <form onSubmit={submit} className="bidform">
      <div className="card"><div className="row"><h3>{form.event.ref}</h3><span className="sub">{t(locale, "closes", { d: closes })}</span></div><div>{form.event.title}</div>
        {form.event.closesAt && form.open && <ClosingClock closesAt={form.event.closesAt} timeZone={form.event.timeZone} locale={locale} />}
        {revision > 0 && <div className="okbox">{t(locale, "revisionSubmitted", { n: revision, t: saved ? `${cur} ${formatDec(parseDec(saved, 2), 2)}` : "-" })} <a className="sublink" href={`/supplier/events/${form.event.id}/receipt`}>{t(locale, "viewReceipt")}</a></div>}
        {form.open && form.event.roundNo > 1 && revision > 0 && <div className="okbox" role="status">{tx(locale, "Final round: your previous prices are carried forward. Change only the lines you want to improve.")} <b>{tx(locale, "{n} lines changed", { n: changedCount })}</b></div>}
        {!form.open && <div className="alert">{form.closedReason}</div>}
      </div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      <div className="card detail">
        <h3>{t(locale, "technicalResponse")}</h3>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} disabled={!form.open} placeholder={t(locale, "techPlaceholder")} />
        {form.gates.length > 0 && (<>
          <h3>{t(locale, "mandatory")}</h3>
          {form.gates.map((g) => (
            <div className="row" key={g}><span>{g}</span>
              <span className="actions" style={{ margin: 0 }}>
                {[true, false].map((v) => <label key={String(v)} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><input type="radio" name={`gate-${g}`} disabled={!form.open} checked={gates[g] === v} onChange={() => setGates((x) => ({ ...x, [g]: v }))} />{v ? t(locale, "yes") : t(locale, "no")}</label>)}
              </span></div>
          ))}
        </>)}
        {form.questionnaire && <Questionnaire locale={locale} view={form.questionnaire} ans={ans} setAns={setAns} open={form.open} docFiles={form.docFiles} />}
        <h3>{(locale === "ar" ? (form.gates.length > 0 ? "٣" : "٢") : (form.gates.length > 0 ? "3" : "2"))}. {t(locale, "prices")} {cur && <span className="sub">({cur})</span>} <HelpTip locale={locale} text="Enter a unit price for every line. Price breaks give a lower unit price at higher quantities. You can submit again until the closing time; the last submission counts." /></h3>
        {form.open && <div className="actions" style={{ marginTop: 0 }}>
          <input ref={file} type="file" hidden accept=".xlsx" onChange={pickSheet} />
          <a className="sublink" href={`/api/supplier/events/${form.event.id}/price-sheet`}>{t(locale, "downloadSheet")}</a>
          <button type="button" className="btn ghost" onClick={() => file.current?.click()}>{t(locale, "uploadSheet")}</button>
        </div>}
        {sheetMsg && <div className={sheetMsg.ok ? "okbox" : "alert"} role="status">{sheetMsg.text}{sheetMsg.errors && sheetMsg.errors.length > 0 && <ul className="errlist">{sheetMsg.errors.map((m, i) => <li key={i}>{m}</li>)}</ul>}</div>}
        <div className="tablewrap"><table className="items"><thead><tr><th>#</th><th>{t(locale, "item")}</th><th className="num">{t(locale, "qty")}</th><th>{t(locale, "unit")}</th><th className="num">{t(locale, "price")}</th></tr></thead><tbody>
          {rowsAll.map((row) => row.kind === "sec" ? <tr key={"sec-" + row.path} className="sechead"><th scope="rowgroup" colSpan={4} style={{ paddingLeft: 8 + (row.depth - 1) * 16, textAlign: "start" }}>{row.label}</th><td className="num"><b>{row.total > 0n ? formatDec(row.total, 2) : ""}</b></td></tr> : row.kind === "lot" ? (() => {
            const st = lotState.find((x) => x.lot.id === row.lot.id)!;
            return <tr key={"lot-" + row.lot.id} className="lothead"><td colSpan={5}>{tx(locale, "Lot {n}", { n: row.lot.lotNo })}: {row.lot.name} <span className="lotsub">{st.status === "empty" ? <span className="sub">{tx(locale, "No bid on this lot")}</span> : st.status === "partial" ? <span className="lotwarn">{tx(locale, "Price every line of this lot or clear them all")}</span> : <span className="sub">{tx(locale, "Lot total")}: {cur} {formatDec(st.total, 2)}</span>}</span></td></tr>;
          })() : (() => { const it = row.it!; return (
            <tr key={it.id}><td>{it.lineNo}</td><td>{it.description}{(it.materialGroup || it.requiredDate || it.specification) && <div className="sub">{[it.materialGroup, it.requiredDate && `${tx(locale, "Required by")} ${it.requiredDate}`].filter(Boolean).join(" · ")}{it.specification && <div style={{ whiteSpace: "pre-wrap" }}>{it.specification}</div>}</div>}{it.blockType === "LUMP_SUM" && <span className="sub"> ({t(locale, "lumpSum")})</span>}{it.zeroOk && <span className="sub"> ({tx(locale, "Optional: enter 0 if included in another price")})</span>}</td><td className="num">{it.quantity}</td><td>{it.unit}</td>
              <td className="num"><input className="priceinput" inputMode="decimal" aria-label={`Price for line ${it.lineNo}`} disabled={!form.open || prices[it.id] === "NB"} placeholder={prices[it.id] === "NB" ? tx(locale, "No bid") : ""}
                value={prices[it.id] === "NB" ? "" : (prices[it.id] ?? "")} onChange={(e) => setPrices((p) => ({ ...p, [it.id]: e.target.value }))} />
                {revision > 0 && (form.prices[it.id] ?? "") !== (prices[it.id] ?? "") && <div className="sub was">{tx(locale, "was {p}", { p: (form.prices[it.id] ?? "") === "" ? "-" : form.prices[it.id] === "NB" ? tx(locale, "No bid") : form.prices[it.id]! })}</div>}
                {it.zeroOk && <label className="sub"> <input type="checkbox" disabled={!form.open} checked={prices[it.id] === "NB"} onChange={(e) => setPrices((p) => ({ ...p, [it.id]: e.target.checked ? "NB" : "" }))} /> {tx(locale, "No bid")}</label>}
                {it.blockType !== "LUMP_SUM" && prices[it.id] !== "NB" && (form.open || (tiers[it.id] ?? []).length > 0) && (
                  <div>
                    <button type="button" className="sublink" onClick={() => setTierOpen(tierOpen === it.id ? null : it.id)} aria-expanded={tierOpen === it.id}>{(tiers[it.id] ?? []).length ? tx(locale, "Price breaks ({n})", { n: (tiers[it.id] ?? []).length }) : tx(locale, "Add price breaks")}</button>
                    {tierOpen === it.id && (
                      <div className="tiers">
                        <div className="sub">{tx(locale, "From this quantity, this unit price. Each break must be cheaper than the one before.")}</div>
                        {(tiers[it.id] ?? []).map((tr, k) => (
                          <div className="actions" key={k} style={{ margin: "4px 0" }}>
                            <input inputMode="decimal" disabled={!form.open} aria-label={tx(locale, "From quantity")} placeholder={tx(locale, "From qty")} value={tr.minQty} onChange={(e) => setTiers((x) => ({ ...x, [it.id]: (x[it.id] ?? []).map((y, n) => (n === k ? { ...y, minQty: e.target.value } : y)) }))} style={{ width: 90 }} />
                            <input inputMode="decimal" disabled={!form.open} aria-label={tx(locale, "Unit price from that quantity")} placeholder={tx(locale, "Unit price")} value={tr.unitPrice} onChange={(e) => setTiers((x) => ({ ...x, [it.id]: (x[it.id] ?? []).map((y, n) => (n === k ? { ...y, unitPrice: e.target.value } : y)) }))} style={{ width: 100 }} />
                            {form.open && <button type="button" className="btn ghost" onClick={() => setTiers((x) => ({ ...x, [it.id]: (x[it.id] ?? []).filter((_, n) => n !== k) }))}>{t(locale, "remove")}</button>}
                          </div>))}
                        {form.open && (tiers[it.id] ?? []).length < MAX_TIERS && <button type="button" className="btn ghost" onClick={() => setTiers((x) => ({ ...x, [it.id]: [...(x[it.id] ?? []), { minQty: "", unitPrice: "" }] }))}>{tx(locale, "Add a break")}</button>}
                        {(() => { const ck = applyTiers(prices[it.id] ?? "", tiers[it.id], it.quantity, it.lineNo); return ck.ok ? (ck.applied ? <div className="sub">{tx(locale, "At quantity {q} the unit price is {p}.", { q: it.quantity, p: formatDec(ck.effective, 4) })}</div> : null) : <div className="lotwarn">{tx(locale, ck.error)}</div>; })()}
                      </div>)}
                  </div>)}</td></tr>
          ); })())}
        </tbody></table></div>
        {!lotted && (form.open || alts.length > 0) && (
          <details open={alts.length > 0}>
            <summary>{tx(locale, "Alternate offers (optional)")} <HelpTip locale={locale} text="An alternate is a complete second offer, for example a different brand. The buyer sees it next to your main offer; it never replaces it unless the buyer chooses it." /></summary>
            <div className="sub">{tx(locale, "Offer a different solution for the whole job, for example another brand or specification. The buyer sees it next to your main offer and where it would rank, but awards your main offer unless you are asked to resubmit.")}</div>
            {alts.map((a, n) => { const tot = altTotal(a); return (
              <div className="bidcard" key={n}>
                <div className="actions" style={{ marginTop: 0 }}>
                  <input disabled={!form.open} aria-label={tx(locale, "Alternate name")} placeholder={tx(locale, "Name, e.g. Brand B pumps")} value={a.label} maxLength={60} onChange={(e) => setAlts((x) => x.map((y, k) => (k === n ? { ...y, label: e.target.value } : y)))} />
                  {form.open && <button type="button" className="btn ghost" onClick={() => setAlts((x) => x.filter((_, k) => k !== n))}>{t(locale, "remove")}</button>}
                </div>
                <textarea rows={2} disabled={!form.open} aria-label={tx(locale, "How it differs")} placeholder={tx(locale, "How does this differ from your main offer?")} value={a.note} maxLength={1000} onChange={(e) => setAlts((x) => x.map((y, k) => (k === n ? { ...y, note: e.target.value } : y)))} />
                <div className="tablewrap"><table className="items"><tbody>{form.items.map((it) => (
                  <tr key={it.id}><td>{it.lineNo}</td><td>{it.description} <span className="sub">{it.quantity} {it.unit}</span></td>
                    <td className="num"><input className="priceinput" inputMode="decimal" disabled={!form.open} aria-label={`${tx(locale, "Alternate price for line")} ${it.lineNo}`} value={a.prices[it.id] ?? ""} onChange={(e) => setAlts((x) => x.map((y, k) => (k === n ? { ...y, prices: { ...y.prices, [it.id]: e.target.value } } : y)))} /></td></tr>))}</tbody></table></div>
                <div className="row"><b>{tx(locale, "Alternate total")}</b><b>{tot === null ? t(locale, "enterEvery") : `${cur} ${formatDec(tot, 2)}`}</b></div>
              </div>); })}
            {form.open && alts.length < 2 && <button type="button" className="btn ghost" onClick={() => setAlts((x) => [...x, { label: "", note: "", prices: {} }])}>{tx(locale, "Add an alternate")}</button>}
          </details>)}
        {lotted && (form.open || bundles.length > 0) && (
          <details open={bundles.length > 0}>
            <summary>{tx(locale, "Bundle discounts (optional)")} <HelpTip locale={locale} text="Offer a percentage off if the buyer awards you several lots together. The discount applies only when every lot in the bundle is awarded to you." /></summary>
            <div className="sub">{tx(locale, "Offer a percentage off if the buyer awards you all of the lots in a bundle.")}</div>
            {bundles.map((b, n) => (
              <div className="bidcard" key={n}>
                <span className="checks">{form.lots.map((l) => <label key={l.id}><input type="checkbox" disabled={!form.open} checked={b.lotIds.includes(l.id)} onChange={() => setBundles((x) => x.map((y, k) => (k === n ? { ...y, lotIds: y.lotIds.includes(l.id) ? y.lotIds.filter((i) => i !== l.id) : [...y.lotIds, l.id] } : y)))} /> {tx(locale, "Lot {n}", { n: l.lotNo })}</label>)}</span>
                <div className="actions" style={{ margin: "6px 0 0" }}>
                  <input inputMode="decimal" disabled={!form.open} aria-label={tx(locale, "Discount percent")} placeholder={tx(locale, "Discount %")} value={b.discountPct} onChange={(e) => setBundles((x) => x.map((y, k) => (k === n ? { ...y, discountPct: e.target.value } : y)))} style={{ width: 110 }} />
                  {form.open && <button type="button" className="btn ghost" onClick={() => setBundles((x) => x.filter((_, k) => k !== n))}>{t(locale, "remove")}</button>}
                </div>
              </div>))}
            {form.open && bundles.length < 5 && form.lots.length > 1 && <button type="button" className="btn ghost" onClick={() => setBundles((x) => [...x, { lotIds: [], discountPct: "" }])}>{tx(locale, "Add a bundle")}</button>}
          </details>)}
        <div className="row"><b>{t(locale, "total")}</b><b>{total === null ? (lotted ? tx(locale, "Price at least one lot completely") : t(locale, "enterEvery")) : `${cur} ${formatDec(total, 2)}`}</b></div>
        {form.open && <div className="actions"><button className="btn" type="submit" disabled={state === "sending" || total === null || !dirty}>{state === "sending" ? t(locale, "submitting") : revision > 0 ? t(locale, "submitRevision") : t(locale, "submitBid")}</button></div>}
      </div>
    </form>
  );
}

function Questionnaire({ locale, view, ans, setAns, open, docFiles }: { docFiles: Record<string, number>; locale: Locale; view: NonNullable<Form["questionnaire"]>; ans: Answers; setAns: React.Dispatch<React.SetStateAction<Answers>>; open: boolean }) {
  const set = (k: string, v: string | boolean | string[]) => setAns((x) => ({ ...x, [k]: v }));
  const shown = view.asks.filter((a) => isVisible(a, ans));
  return (<>
    {view.buyerFields.length > 0 && <><h3>{tx(locale, "Buyer requirements")}</h3>{view.buyerFields.map((f) => <div className="row" key={f.key}><span>{lab(f.label, locale)}</span><b>{f.value}</b></div>)}</>}
    {view.sections.map((sec) => { const qs = shown.filter((a) => a.section === sec.key); return qs.length === 0 ? null : (
      <div key={sec.key}><h3>{lab(sec.label, locale)}</h3>
        {qs.map((a) => (
          <label key={a.key} className="qrow">{lab(a.label, locale)}{isRequired(a, ans) ? " *" : ""}
            {a.type === "longtext" ? <textarea rows={3} disabled={!open} value={String(ans[a.key] ?? "")} onChange={(e) => set(a.key, e.target.value)} />
              : a.type === "single" ? <select disabled={!open} value={String(ans[a.key] ?? "")} onChange={(e) => set(a.key, e.target.value)}><option value="">{tx(locale, "Choose…")}</option>{a.options?.map((o) => <option key={o.key} value={o.key}>{lab(o.label, locale)}</option>)}</select>
              : a.type === "multi" ? <span className="checks">{a.options?.map((o) => { const cur = Array.isArray(ans[a.key]) ? (ans[a.key] as string[]) : []; return <label key={o.key}><input type="checkbox" disabled={!open} checked={cur.includes(o.key)} onChange={() => set(a.key, cur.includes(o.key) ? cur.filter((x) => x !== o.key) : [...cur, o.key])} /> {lab(o.label, locale)}</label>; })}</span>
              : a.type === "boolean" || a.type === "yesno" ? <span>{[true, false].map((v) => <label key={String(v)}><input type="radio" name={`q-${a.key}`} disabled={!open} checked={ans[a.key] === v} onChange={() => set(a.key, v)} /> {v ? tx(locale, "Yes") : tx(locale, "No")}</label>)}</span>
              : <input disabled={!open} type={a.type === "date" ? "date" : "text"} inputMode={a.type === "integer" || a.type === "decimal" || a.type === "money" ? "decimal" : undefined} value={String(ans[a.key] ?? "")} onChange={(e) => set(a.key, e.target.value)} />}
            {a.help && <span className="sub">{lab(a.help, locale)}</span>}
          </label>))}
      </div>); })}
    {view.documents.length > 0 && <><h3>{tx(locale, "Documents to attach")}</h3><ul>{view.documents.map((d) => <li key={d.key}>{lab(d.label, locale)}{isRequired({ key: d.key, label: d.label, type: "text", envelope: d.envelope, required: d.required, section: "general" }, ans) ? ` (${tx(locale, "required")})` : ""}: <b>{(docFiles[d.key] ?? 0) > 0 ? tx(locale, "Attached") : tx(locale, "Not attached")}</b> <span className="sub">{lab(d.purpose, locale)}</span></li>)}</ul><div className="sub">{tx(locale, "Attach these files in the Requested documents panel below the form.")}</div></>}
  </>);
}
