import Link from "next/link";
import { redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { awardsReport } from "@/reports/service";

const aed = (v: string | null) => (v == null ? "-" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const r = await awardsReport(getPool(), s);
  return (
    <Shell title="Awards" action={r.rows.length ? <a className="btn ghost" href="/api/export/awards">Export to Excel</a> : undefined}>
      <section className="kpis">
        <div className="kpi"><small>Events awarded</small><strong>{r.kpis.count}</strong></div>
        <div className="kpi"><small>Awarded value (AED)</small><strong>{aed(r.kpis.awarded)}</strong></div>
        <div className="kpi orange"><small>Estimated value (AED)</small><strong>{aed(r.kpis.estimated)}</strong></div>
        <div className="kpi green"><small>Saving against estimate</small><strong>{r.kpis.savingPct == null ? "-" : `${r.kpis.savingPct}%`}</strong><em>AED {aed(r.kpis.saving)}</em></div>
      </section>
      {r.rows.length === 0 ? <div className="card"><h3>No awards yet</h3><div className="sub">Awarded events appear here with the winner and the saving against the estimate. Enter an estimated value on the event to see savings.</div></div> : (
        <div className="card detail"><div className="tablewrap"><table className="items"><thead><tr><th>Event</th><th>Supplier</th><th className="num">Awarded</th><th className="num">Estimate</th><th className="num">Saving</th><th /></tr></thead><tbody>
          {r.rows.map((x) => (
            <tr key={x.id}><td>{x.ref}<div className="sub">{x.title}</div></td><td>{x.supplier}</td><td className="num">{x.currency} {aed(x.total)}</td><td className="num">{aed(x.estimate)}</td>
              <td className="num">{x.saving == null ? "-" : `${aed(x.saving)} (${x.savingPct}%)`}</td><td><Link className="btn ghost" href={`/events/${x.id}/pack`}>Pack</Link></td></tr>
          ))}
        </tbody></table></div></div>)}
    </Shell>
  );
}
