import { notFound, redirect } from "next/navigation";
import { getSupplierSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getBidForm } from "@/bids/service";
import { formatDec, parseDec } from "@/engine/decimal";
import PrintButton from "@/ui/PrintButton";
import { getLocale } from "@/i18n/server";
import { dateLocale, t } from "@/i18n/dict";

export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const who = await getSupplierSession();
  if (!who) redirect("/no-access");
  const f = await getBidForm(getPool(), who, id);
  if (!f || !f.revisionNo || !f.fingerprint) notFound();
  const at = f.submittedAt ? new Date(f.submittedAt).toLocaleString(dateLocale(locale), { dateStyle: "long", timeStyle: "medium", timeZone: "UTC" }) + " UTC" : "";
  return (
    <div className="pack">
      <div className="packbar"><a className="sublink" href={`/supplier/events/${id}`}>{t(locale, "back")}</a><PrintButton label={t(locale, "print")} /></div>
      <h1>{t(locale, "bidReceipt")}</h1>
      <p>{f.event.ref}: {f.event.title}</p>
      <table className="items"><tbody>
        <tr><th>{t(locale, "supplier")}</th><td>{who.supplierName}</td></tr>
        <tr><th>{t(locale, "revision")}</th><td>{f.revisionNo}</td></tr>
        <tr><th>{t(locale, "submitted")}</th><td>{at}</td></tr>
        <tr><th>{t(locale, "total")}</th><td>{f.event.currency} {formatDec(parseDec(f.total ?? "0", 2), 2)}</td></tr>
        <tr><th>{t(locale, "fingerprint")}</th><td><code>{f.fingerprint}</code></td></tr>
      </tbody></table>
      <h2>{t(locale, "pricesSubmitted")}</h2>
      <table className="items"><thead><tr><th>#</th><th>{t(locale, "item")}</th><th className="num">{t(locale, "qty")}</th><th>{t(locale, "unit")}</th><th className="num">{t(locale, "unitPrice")}</th></tr></thead><tbody>
        {f.items.map((it) => <tr key={it.id}><td>{it.lineNo}</td><td>{it.description}</td><td className="num">{it.quantity}</td><td>{it.unit}</td><td className="num">{f.prices[it.id]}</td></tr>)}
      </tbody></table>
      {f.gates.length > 0 && (<><h2>{t(locale, "declarations")}</h2><table className="items"><tbody>{f.gates.map((g) => <tr key={g}><td>{g}</td><td>{f.gateAnswers[g] ? t(locale, "yes") : t(locale, "no")}</td></tr>)}</tbody></table></>)}
      <p className="sub">{t(locale, "receiptNote")}</p>
    </div>
  );
}
