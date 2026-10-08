"use client";
import { useState } from "react";
import type { AwardedRow, Target } from "@/handover/service";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { sendHandoverAction } from "../../app/integrations/actions";

export default function HandoverList({ rows, locale = "en" }: { rows: AwardedRow[]; locale?: Locale }) {
  const [refs, setRefs] = useState<Record<string, string>>(() => Object.fromEntries(rows.filter((r) => r.last?.status === "sent").map((r) => [r.id, `${r.last!.reference} (${r.last!.target})`])));
  const [target, setTarget] = useState<Record<string, Target>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function send(id: string) {
    setError(null); setBusy(id);
    const t = target[id] ?? "SAP";
    const r = await sendHandoverAction(id, t).catch(() => ({ ok: false as const, error: "That could not be sent. Try again." }));
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setRefs((x) => ({ ...x, [id]: `${r.reference} (${t})` }));
  }
  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Award handover")}</h3><span className="pill">{tx(locale, "Test mode")}</span></div>
      <div className="sub">{tx(locale, "Awarded events can be passed to SAP or Ariba. In test mode nothing is sent: a reference is recorded so you can check the flow and the data. Download the payload to see exactly what would be sent.")}</div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      {rows.length === 0 ? <div className="sub">{tx(locale, "No awarded events yet.")}</div> : (
        <div className="tablewrap"><table className="items"><thead><tr><th>{tx(locale, "Event")}</th><th>{tx(locale, "Supplier")}</th><th className="num">{tx(locale, "Total")}</th><th>{tx(locale, "Handover")}</th></tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.id}><td>{r.ref}<div className="sub">{r.title}</div></td><td>{r.vendor}</td><td className="num">{r.currency} {r.total}</td>
              <td>{refs[r.id] ? <span className="okbox" style={{ display: "inline-block", margin: 0 }}>{tx(locale, "Sent: {ref}", { ref: refs[r.id] ?? "" })}</span> : (
                <span className="actions" style={{ margin: 0 }}>
                  <select aria-label={tx(locale, "Target system")} value={target[r.id] ?? "SAP"} onChange={(e) => setTarget((x) => ({ ...x, [r.id]: e.target.value as Target }))}><option value="SAP">SAP</option><option value="ARIBA">Ariba</option></select>
                  <button className="btn" type="button" disabled={busy === r.id} onClick={() => send(r.id)}>{busy === r.id ? tx(locale, "Sending...") : tx(locale, "Send (test)")}</button>
                  <a className="sublink" href={`/api/handover/${r.id}?target=${target[r.id] ?? "SAP"}`}>{tx(locale, "Payload")}</a>
                </span>)}</td></tr>
          ))}
        </tbody></table></div>)}
    </div>
  );
}
