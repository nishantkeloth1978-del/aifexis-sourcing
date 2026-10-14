"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { lab } from "./lab";
import type { Need, PreviewRow, TemplatePreview } from "@/templates/preview";
import { templatePreviewAction } from "../../app/templates/actions";

const cache = new Map<string, TemplatePreview | null>();
/** Puts a preview in the visit cache (used by tests). */
export const seedPreview = (key: string, d: TemplatePreview | null) => { cache.set(key, d); };
const NEED: Record<Need, string> = { required: "Required", optional: "Optional", conditional: "Required in some cases" };
const USE: Record<string, string> = { info: "Information", qualification: "Qualification", scoring: "Scored" };
const MODEL: Record<string, string> = { itemized: "Itemised price lines", person_day: "Person-day rates", manpower: "Manpower rates", subscription: "Subscription", milestone: "Milestone payments", freight: "Freight lanes", mixed: "Mixed pricing", none: "No price lines" };
const MODE: Record<string, string> = { qualification: "Qualification only", price: "Lowest price", weighted: "Weighted score", manual: "Manual" };

function Tags({ r, locale }: { r: PreviewRow; locale: Locale }) {
  return (<>
    {r.envelope && <span className={"tpltag " + (r.envelope === "commercial" ? "c" : "t")}>{tx(locale, r.envelope === "commercial" ? "Commercial" : "Technical")}</span>}
    <span className={"tpltag " + (r.need === "required" ? "req" : "opt")}>{tx(locale, NEED[r.need])}</span>
  </>);
}

/**
 * Wraps a template name. Hover, keyboard focus or a tap opens a read-only card listing what the template contains.
 * The content is fetched the first time and kept for the rest of the visit.
 */
export default function TemplateHover({ templateKey, children, locale = "en" }: { templateKey: string; children: React.ReactNode; locale?: Locale }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TemplatePreview | null | undefined>(cache.has(templateKey) ? cache.get(templateKey) : undefined);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const wrap = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function load() {
    if (cache.has(templateKey)) { setData(cache.get(templateKey)); return; }
    templatePreviewAction(templateKey).then((d) => { cache.set(templateKey, d); setData(d); }).catch(() => setData(null));
  }
  function show(delay = 180) { clearTimeout(timer.current); timer.current = setTimeout(() => { setOpen(true); load(); }, delay); }
  function hide(delay = 150) { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), delay); }
  useEffect(() => () => clearTimeout(timer.current), []);
  // The card is drawn on the page itself (a portal) so no card, table or scroll area around the name can cover or cut it.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      if (!wrap.current) return;
      const r = wrap.current.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
      if (vw <= 640) { setPos({}); return; }                                   // phones: bottom panel from the stylesheet
      const w = Math.min(520, vw - 24);
      const left = Math.max(12, Math.min(locale === "ar" ? r.right - w : r.left, vw - w - 12));
      const below = vh - r.bottom - 16, above = r.top - 16;
      const down = below >= 320 || below >= above;
      setPos(down ? { left, top: r.bottom + 8, width: w, maxHeight: Math.max(160, Math.min(vh * 0.7, below - 8)) } : { left, bottom: vh - r.top + 8, width: w, maxHeight: Math.max(160, Math.min(vh * 0.7, above - 8)) });
    };
    place();
    window.addEventListener("scroll", place, true); window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open, data, locale]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); } };
    const d = (e: MouseEvent) => { const t = e.target as Node; if (!wrap.current?.contains(t) && !pop.current?.contains(t)) setOpen(false); };
    document.addEventListener("keydown", k); document.addEventListener("mousedown", d);
    return () => { document.removeEventListener("keydown", k); document.removeEventListener("mousedown", d); };
  }, [open]);

  const d = data;
  return (
    <span className="tplhover" ref={wrap} onMouseEnter={() => show()} onMouseLeave={() => hide()}>
      <button type="button" className="tplname" aria-expanded={open} aria-controls={id} onFocus={() => show(0)} onBlur={(e) => { const t = e.relatedTarget as Node | null; if (!wrap.current?.contains(t) && !pop.current?.contains(t)) hide(0); }}
        onClick={(e) => { e.preventDefault(); if (open) setOpen(false); else { setOpen(true); load(); } }}>{children}</button>
      {open && createPortal(
        <div id={id} ref={pop} dir={locale === "ar" ? "rtl" : "ltr"} style={pos} className="tplpop" role="region" onMouseEnter={() => show(0)} onMouseLeave={() => hide()} onBlur={(e) => { const t = e.relatedTarget as Node | null; if (!pop.current?.contains(t) && !wrap.current?.contains(t)) hide(0); }} aria-label={tx(locale, "What this template contains")} tabIndex={0} onClick={(e) => e.preventDefault()}>
          {d === undefined && <div className="tplsec">{tx(locale, "Loading...")}</div>}
          {d === null && <div className="tplsec">{tx(locale, "The template contents could not be loaded.")}</div>}
          {d && (<>
            <div className="tplhead"><b>{lab(d.title, locale)}</b>
              <div className="sub">{lab(d.summary, locale)}</div>
              <div className="tplchips">
                <span className="tplchip">{d.eventType}</span><span className="tplchip">{tx(locale, "Version {n}", { n: d.version })}</span>
                <span className="tplchip">{tx(locale, d.envelopes === 2 ? "Two envelopes" : "One envelope")}</span>
                <span className="tplchip">{tx(locale, "{n} event fields", { n: d.counts.fields })}</span><span className="tplchip">{tx(locale, "{n} questions", { n: d.counts.questions })}</span>
                <span className="tplchip">{tx(locale, "{n} documents", { n: d.counts.documents })}</span><span className="tplchip">{tx(locale, "{n} price lines", { n: d.counts.lines })}</span>
                <span className="tplchip">{tx(locale, "{n} criteria", { n: d.counts.criteria })}</span>
              </div></div>
            {d.fields.length > 0 && <div className="tplsec"><h4>{tx(locale, "Event details the buyer fills in")} ({d.fields.length})</h4>
              {d.fields.map((f, i) => <div className="tplrow" key={i}><span className="l">{lab(f.label, locale)}</span><Tags r={{ ...f, envelope: undefined }} locale={locale} /></div>)}</div>}
            {d.questions.length > 0 && <div className="tplsec"><h4>{tx(locale, "Questions suppliers answer")} ({d.questions.length})</h4>
              {d.questions.map((q, i) => <div className="tplrow" key={i}><span className="l">{lab(q.label, locale)}</span><span className="tpltag q">{tx(locale, USE[q.use] ?? "Information")}</span><Tags r={q} locale={locale} /></div>)}</div>}
            {d.documents.length > 0 && <div className="tplsec"><h4>{tx(locale, "Documents requested")} ({d.documents.length})</h4>
              {d.documents.map((x, i) => <div className="tplrow" key={i}><span className="l">{lab(x.label, locale)}</span><Tags r={x} locale={locale} /><span className="m">{x.fileTypes.map((f) => f.toUpperCase()).join(", ")}{x.expiry ? ` · ${tx(locale, "expiry date")}` : ""}</span></div>)}</div>}
            {(d.pricing.lines.length > 0 || d.pricing.groups.length > 0) && <div className="tplsec"><h4>{tx(locale, "Pricing")}: {tx(locale, MODEL[d.pricing.model] ?? "Mixed pricing")}</h4>
              {d.pricing.groups.map((g, i) => <div className="tplrow" key={"g" + i}><span className="l">{lab(g.label, locale)}{g.repeat ? ` (${tx(locale, "repeats")})` : ""}</span><span className="m">{g.inputs.map((x) => lab(x, locale)).join(", ")}</span></div>)}
              {d.pricing.lines.map((l, i) => <div className="tplrow" key={i}><span className="l">{lab(l.label, locale)}</span><span className="m">{tx(locale, l.how === "lump" ? "Lump sum" : "Quantity x unit price")}{l.optional ? ` · ${tx(locale, "optional")}` : ""}</span></div>)}</div>}
            <div className="tplsec"><h4>{tx(locale, "Evaluation")}</h4>
              <div className="tplrow"><span className="l">{tx(locale, MODE[d.evaluation.mode] ?? "Manual")}. {tx(locale, "Scores run from {a} to {b}.", { a: d.evaluation.scale.min, b: d.evaluation.scale.max })}</span></div>
              {d.evaluation.criteria.length > 0 && <div className="tplrow"><span className="l">{tx(locale, "Criteria")}: {d.evaluation.criteria.map((c) => lab(c, locale)).join(" · ")}</span></div>}
              <div className="sub">{tx(locale, "Weights and the pass mark come from your company configuration.")}</div></div>
            <div className="tplfoot">{tx(locale, "Preview only.")}</div>
          </>)}
        </div>, document.body)}
    </span>
  );
}
