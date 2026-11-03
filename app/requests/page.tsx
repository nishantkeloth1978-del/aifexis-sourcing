import Link from "next/link";
import { redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import { dateLocale } from "@/i18n/dict";
import Shell from "@/ui/Shell";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { can } from "@/access/permissions";
import { listRequests } from "@/requests/service";

export const metadata = { title: "Requests | Aifexis Sourcing" };
const STATES = ["new", "converted", "rejected", "withdrawn"] as const;
const LABEL: Record<string, string> = { new: "New", converted: "Became an event", rejected: "Not taken forward", withdrawn: "Withdrawn" };

const PILL: Record<string, string> = { new: "warn", converted: "done", rejected: "bad", withdrawn: "" };

export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const { state } = await searchParams;
  const rows = await listRequests(getPool(), s, { state });
  const all = can(s, "event.create");
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(locale), { dateStyle: "medium", timeZone: "UTC" });
  return (
    <Shell title={tx(locale, "Requests")} action={<span className="row" style={{ gap: 8 }}><Link className="btn ghost" href="/requests/import">{tx(locale, "Import from CSV")}</Link>{all && <a className="btn ghost" href="/api/export/requests">{tx(locale, "Export CSV")}</a>}<Link className="btn" href="/requests/new">{tx(locale, "New request")}</Link></span>}>
      <div className="sub" style={{ marginBottom: 10 }}>{all ? tx(locale, "Everyone's requests. Open one to turn it into a draft event or send it back with a reason.") : tx(locale, "Your requests. A buyer will turn them into sourcing events.")}</div>
      <div className="filters">
        <Link className={state ? "btn ghost" : "btn"} href="/requests">{tx(locale, "All")}</Link>
        {STATES.map((st) => <Link key={st} className={state === st ? "btn" : "btn ghost"} href={`/requests?state=${st}`}>{tx(locale, LABEL[st]!)}</Link>)}
      </div>
      {rows.length === 0 ? <div className="card">{tx(locale, "No requests yet.")}</div> : (
        <table className="table">
          <thead><tr><th>{tx(locale, "Reference")}</th><th>{tx(locale, "Title")}</th><th>{tx(locale, "Type")}</th>{all && <th>{tx(locale, "Requested by")}</th>}<th>{tx(locale, "Raised")}</th><th>{tx(locale, "Status")}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/requests/${r.id}`}>{r.ref}</Link></td><td className="title" title={r.title}>{r.title}</td><td className="muted">{tx(locale, r.kind === "goods" ? "Goods" : "Service")}</td>
              {all && <td className="muted">{r.requester || "—"}</td>}<td className="muted">{fmt(r.createdAt)}</td><td><span className={`pill ${PILL[r.state] ?? ""}`}>{tx(locale, LABEL[r.state]!)}</span>{r.eventRef ? <> <span className="sub">{r.eventRef}</span></> : null}</td>
            </tr>))}</tbody>
        </table>)}
    </Shell>
  );
}
