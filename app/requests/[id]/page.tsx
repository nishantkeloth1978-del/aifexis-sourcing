import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import { dateLocale } from "@/i18n/dict";
import Shell from "@/ui/Shell";
import RequestActions from "@/ui/RequestActions";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { can } from "@/access/permissions";
import { getRequest } from "@/requests/service";

export const metadata = { title: "Request | Aifexis Sourcing" };
const LABEL: Record<string, string> = { new: "New", converted: "Became an event", rejected: "Not taken forward", withdrawn: "Withdrawn" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const { id } = await params;
  const r = await getRequest(getPool(), s, id);
  if (!r) notFound();
  const locale = await getLocale();
  const day = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString(dateLocale(locale), { dateStyle: "medium", timeZone: "UTC" });
  return (
    <Shell title={`${r.ref} · ${r.title}`}>
      <div className="card detail" style={{ maxWidth: 760 }}>
        <div className="row"><b>{tx(locale, LABEL[r.state]!)}</b>{r.eventId && <Link href={`/events/${r.eventId}`}>{r.eventRef}</Link>}</div>
        <div className="sub">{tx(locale, r.kind === "goods" ? "Goods" : "Service")} · {tx(locale, "Requested by")} {r.requester}{r.ownerDept ? ` · ${r.ownerDept}` : ""}{r.neededBy ? ` · ${tx(locale, "Needed by")} ${day(r.neededBy)}` : ""}{r.estValue ? ` · ${tx(locale, "Estimated value")} ${r.estValue} ${r.currency}` : ""}</div>
        {r.description && <p style={{ whiteSpace: "pre-wrap" }}>{r.description}</p>}
        {r.lines.length > 0 && (
          <table className="table"><thead><tr><th>#</th><th>{tx(locale, "Description")}</th><th>{tx(locale, "Quantity")}</th><th>{tx(locale, "Unit")}</th></tr></thead>
            <tbody>{r.lines.map((l, i) => <tr key={i}><td>{i + 1}</td><td>{l.description}</td><td>{l.quantity}</td><td>{l.unit}</td></tr>)}</tbody></table>)}
        {r.decisionNote && <div className="sub"><b>{tx(locale, "Reason")}:</b> {r.decisionNote}</div>}
        {r.state === "new" && <RequestActions locale={locale} id={r.id} canHandle={can(s, "event.create")} mine={r.mine} />}
      </div>
    </Shell>
  );
}
