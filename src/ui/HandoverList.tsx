"use client";
import { useState } from "react";
import type { AwardedRow, Target } from "@/handover/service";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { sendHandoverAction } from "../../app/integrations/actions";

export default function HandoverList({ rows, locale = "en" }: { rows: AwardedRow[]; locale?: Locale }) {
  const key = (id: string, sid: string) => `${id}:${sid}`;
  const [refs, setRefs] = useState<Record<string, string>>(() => Object.fromEntries(rows.flatMap((r) => r.vendors.filter((v) => v.last?.status === "sent").map((v) => [key(r.id, v.supplierId), `${v.last!.reference} (${v.last!.target})`]))));
  const [target, setTarget] = useState<Record<string, Target>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function send(id: string, sid: string) {
    const k = key(id, sid);
    setError(null); setBusy(k);
    const t = target[k] ?? "SAP";
    const r = await sendHandoverAction(id, t, sid).catch(() => ({ ok: false as const, error: "That could not be sent. Try again." }));
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setRefs((x) => ({ ...x, [k]: `${r.reference} (${t})` }));
  }
  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Award handover")}</h3><span className="pill">{tx(locale, "Test mode")}</span></div>
      <div className="sub">{tx(locale, "Awarded events can be passed to SAP or Ariba. In test mode nothing is sent: a reference is recorded so you can check the flow and the data. Download the payload to see exactly what would be sent.")}</div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      {rows.length === 0 ? <div className="sub">{tx(locale, "No awarded events yet.")}</div> : (
        <div className="tablewrap"><table className="items"><thead><tr><th>{tx(locale, "Event")}</th><th>{tx(locale, "Supplier")}</th><th className="num">{tx(locale, "Total")}</th><th>{tx(locale, "Handover")}</th></tr></thead><tbody>
          {rows.flatMap((r) => r.vendors.map((v) => { const k = key(r.id, v.supplierId); return (
            <tr key={k}><td>{r.ref}<div className="sub">{r.title}</div></td><td>{v.name}{v.lots.length > 0 && <div className="sub">{v.lots.map((l) => tx(locale, "Lot") + " " + l).join(", ")}</div>}</td><td className="num">{r.currency} {v.total}</td>
              <td>{refs[k] ? <span className="okbox" style={{ display: "inline-block", margin: 0 }}>{tx(locale, "Sent: {ref}", { ref: refs[k] ?? "" })}</span> : (
                <span className="actions" style={{ margin: 0 }}>
                  <select aria-label={tx(locale, "Target system")} value={target[k] ?? "SAP"} onChange={(e) => setTarget((x) => ({ ...x, [k]: e.target.value as Target }))}><option value="SAP">SAP</option><option value="ARIBA">Ariba</option></select>
                  <button className="btn" type="button" disabled={busy === k} onClick={() => send(r.id, v.supplierId)}>{busy === k ? tx(locale, "Sending...") : tx(locale, "Send (test)")}</button>
                  <a className="sublink" href={`/api/handover/${r.id}?target=${target[k] ?? "SAP"}&supplier=${v.supplierId}`}>{tx(locale, "Payload")}</a>
                </span>)}</td></tr>); }))}
        </tbody></table></div>)}
    </div>
  );
}
