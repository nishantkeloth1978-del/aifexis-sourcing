import Link from "next/link";
import { redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { awardsReport } from "@/reports/service";
import { getLocale } from "@/i18n/server";
import { t } from "@/i18n/dict";

const aed = (v: string | null) => (v == null ? "-" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const r = await awardsReport(getPool(), s);
  return (
    <Shell title={t(locale, "titleAwards")} action={r.rows.length ? <a className="btn ghost" href="/api/export/awards">{t(locale, "exportExcel")}</a> : undefined}>
      <section className="kpis">
        <div className="kpi"><small>{t(locale, "aEvents")}</small><strong>{r.kpis.count}</strong></div>
        <div className="kpi"><small>{t(locale, "aValue")}</small><strong>{aed(r.kpis.awarded)}</strong></div>
        <div className="kpi orange"><small>{t(locale, "aEst")}</small><strong>{aed(r.kpis.estimated)}</strong></div>
        <div className="kpi green"><small>{t(locale, "aSaving")}</small><strong>{r.kpis.savingPct == null ? "-" : `${r.kpis.savingPct}%`}</strong><em>AED {aed(r.kpis.saving)}</em></div>
      </section>
      {r.rows.length === 0 ? <div className="card"><h3>{t(locale, "noAwards")}</h3><div className="sub">{t(locale, "noAwardsSub")}</div></div> : (
        <div className="card detail"><div className="tablewrap"><table className="items"><thead><tr><th>{t(locale, "colEvent")}</th><th>{t(locale, "colSupplier")}</th><th className="num">{t(locale, "colAwarded")}</th><th className="num">{t(locale, "colEstimate")}</th><th className="num">{t(locale, "colSaving")}</th><th /></tr></thead><tbody>
          {r.rows.map((x) => (
            <tr key={x.id}><td>{x.ref}<div className="sub">{x.title}</div></td><td>{x.supplier}</td><td className="num">{x.currency} {aed(x.total)}</td><td className="num">{aed(x.estimate)}</td>
              <td className="num">{x.saving == null ? "-" : `${aed(x.saving)} (${x.savingPct}%)`}</td><td><Link className="btn ghost" href={`/events/${x.id}/pack`}>{t(locale, "packBtn")}</Link></td></tr>
          ))}
        </tbody></table></div></div>)}
    </Shell>
  );
}
