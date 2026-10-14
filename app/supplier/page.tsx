import { staffLanding } from "@/lib/portal";
import LiveClock from "@/ui/LiveClock";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, getSupplierSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { laneOf, listInvitedEvents, type Lane } from "@/suppliers/service";
import NoteList from "@/ui/NoteList";
import { listNotesForSupplierUser } from "@/notifications/service";
import { signOut } from "../login/actions";
import { getLocale } from "@/i18n/server";
import { dateLocale, t, type Locale } from "@/i18n/dict";
import LangSwitch from "@/ui/LangSwitch";

export const metadata = { title: "Supplier portal | Aifexis Sourcing" };
const fmt = (iso: string | null, l: Locale) => (iso ? new Date(iso).toLocaleString(dateLocale(l), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : t(l, "noClosing"));

const LANES: { key: Lane; label: "laneTodo" | "laneSubmitted" | "laneEvaluation" | "laneResults" }[] = [{ key: "todo", label: "laneTodo" }, { key: "submitted", label: "laneSubmitted" }, { key: "evaluation", label: "laneEvaluation" }, { key: "results", label: "laneResults" }];

export default async function SupplierPortal({ searchParams }: { searchParams?: Promise<{ lane?: string }> }) {
  const sp = (await searchParams) ?? {};
  const locale = await getLocale();
  const who = await getSupplierSession();
  if (!who) redirect((await getSession()) ? staffLanding() : "/no-access");
  const [events, notes] = await Promise.all([listInvitedEvents(getPool(), who), listNotesForSupplierUser(getPool(), who.tenantId, who.supplierUserId)]);
  const withLane = events.map((e) => ({ e, lane: laneOf(e) }));
  const count = (l: Lane) => withLane.filter((x) => x.lane === l).length;
  const lane = LANES.some((l) => l.key === sp.lane) ? (sp.lane as Lane) : null;
  const shown = lane ? withLane.filter((x) => x.lane === lane) : withLane;
  const soon = (e: { state: string; closesAt: string | null }) => e.state === "published" && e.closesAt != null && new Date(e.closesAt).getTime() - Date.now() < 86400000 && new Date(e.closesAt).getTime() > Date.now();
  return (
    <div className="supwrap">
      <header className="suptop"><div><b>AIFEXIS</b><small>{who.supplierName}</small></div>
        <span><LangSwitch locale={locale} /> <form action={signOut} style={{ display: "inline" }}><button className="signout" type="submit">{t(locale, "signOut")}</button></form></span></header>
      <main className="supmain" id="main" tabIndex={-1}>
        <NoteList notes={notes} linkBase="/supplier/events" locale={locale} />
        <h2 style={{ margin: 0 }}>{t(locale, "yourInvitations")}</h2>
        <nav className="lanes" aria-label={t(locale, "yourInvitations")}>
          <Link href="/supplier" className={"lane" + (lane ? "" : " on")} aria-current={lane ? undefined : "page"}>{t(locale, "laneAll")} <b>{events.length}</b></Link>
          {LANES.map((l) => <Link key={l.key} href={`/supplier?lane=${l.key}`} className={"lane" + (lane === l.key ? " on" : "")} aria-current={lane === l.key ? "page" : undefined}>{t(locale, l.label)} <b>{count(l.key)}</b></Link>)}
        </nav>
        {shown.length === 0 ? <div className="card"><div className="sub">{events.length === 0 ? t(locale, "noInvitations") : t(locale, "laneEmpty")}</div></div> :
          shown.map(({ e }) => (
            <div className="card" key={e.id}>
              <div className="row"><h3>{e.ref}</h3><span className="sub">{e.buyer}</span></div>
              <div>{e.title}</div>
              <div className="sub">{t(locale, "closes", { d: fmt(e.closesAt, locale) })}{e.state === "published" && e.closesAt && <> · <LiveClock closesAt={e.closesAt} locale={locale} /></>}</div>
              {e.state === "published" && <div className={e.revisionNo > 0 ? "sub" : soon(e) ? "alert" : "sub"}>{e.revisionNo > 0 ? t(locale, "bidSent", { n: e.revisionNo, d: fmt(e.submittedAt, locale) }) : soon(e) ? t(locale, "dueSoon") : t(locale, "bidNotSent")}</div>}
              {e.state === "published" ? <Link className="btn" style={{ alignSelf: "flex-start" }} href={`/supplier/events/${e.id}`}>{t(locale, e.revisionNo > 0 ? "reviseBid" : "openBid")}</Link> : e.outcome === "won" ? <div className="okbox">{t(locale, "awardedYou")}</div> : e.outcome === "lost" ? <div className="sub">{t(locale, "awardedOther")}</div> : <div className="sub">{t(locale, "closedForBids")}</div>}
            </div>
          ))}
      </main>
    </div>
  );
}
