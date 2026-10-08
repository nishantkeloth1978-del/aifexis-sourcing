import Link from "next/link";
import { redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { evaluationBoard } from "@/reports/service";
import { getLocale } from "@/i18n/server";
import { t, type Key } from "@/i18n/dict";

const NEXT: Record<string, Key> = { closed: "n_closed", technical_evaluation: "n_tech", technical_approved: "n_techok", commercial_evaluation: "n_comm", recommended: "n_rec", pending_award: "n_pendaward" };
const LABEL: Record<string, Key> = { closed: "g_closed", technical_evaluation: "g_tech", technical_approved: "g_techok", commercial_evaluation: "g_comm", recommended: "g_rec", pending_award: "g_pendaward" };

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const rows = await evaluationBoard(getPool(), s);
  return (
    <Shell title={t(locale, "titleEvaluations")}>
      {rows.length === 0 ? <div className="card"><h3>{t(locale, "evNothing")}</h3><div className="sub">{t(locale, "evNothingSub")}</div></div> : (
        <div className="card detail"><div className="tablewrap"><table className="items"><thead><tr><th>{t(locale, "colEvent")}</th><th>{t(locale, "colStage")}</th><th className="num">{t(locale, "colBidders")}</th><th>{t(locale, "colNext")}</th><th /></tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.id}><td>{r.ref}<div className="sub">{r.title}</div></td><td><span className="pill warn">{LABEL[r.state] ? t(locale, LABEL[r.state]!) : r.state}</span></td><td className="num">{r.bidders}</td><td>{NEXT[r.state] ? t(locale, NEXT[r.state]!) : ""}</td><td><Link className="btn ghost" href={`/events/${r.id}`}>{t(locale, "openBtn")}</Link></td></tr>
          ))}
        </tbody></table></div></div>)}
    </Shell>
  );
}
