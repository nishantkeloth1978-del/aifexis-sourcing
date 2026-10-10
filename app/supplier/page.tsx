import LiveClock from "@/ui/LiveClock";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, getSupplierSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listInvitedEvents } from "@/suppliers/service";
import NoteList from "@/ui/NoteList";
import { listNotesForSupplierUser } from "@/notifications/service";
import { signOut } from "../login/actions";
import { getLocale } from "@/i18n/server";
import { dateLocale, t, type Locale } from "@/i18n/dict";
import LangSwitch from "@/ui/LangSwitch";

export const metadata = { title: "Supplier portal | Aifexis Sourcing" };
const fmt = (iso: string | null, l: Locale) => (iso ? new Date(iso).toLocaleString(dateLocale(l), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : t(l, "noClosing"));

export default async function SupplierPortal() {
  const locale = await getLocale();
  const who = await getSupplierSession();
  if (!who) redirect((await getSession()) ? "/" : "/no-access");
  const [events, notes] = await Promise.all([listInvitedEvents(getPool(), who), listNotesForSupplierUser(getPool(), who.tenantId, who.supplierUserId)]);
  return (
    <div className="supwrap">
      <header className="suptop"><div><b>AIFEXIS</b><small>{who.supplierName}</small></div>
        <span><LangSwitch locale={locale} /> <form action={signOut} style={{ display: "inline" }}><button className="signout" type="submit">{t(locale, "signOut")}</button></form></span></header>
      <main className="supmain">
        <NoteList notes={notes} linkBase="/supplier/events" locale={locale} />
        <h2 style={{ margin: 0 }}>{t(locale, "yourInvitations")}</h2>
        {events.length === 0 ? <div className="card"><div className="sub">{t(locale, "noInvitations")}</div></div> :
          events.map((e) => (
            <div className="card" key={e.id}>
              <div className="row"><h3>{e.ref}</h3><span className="sub">{e.buyer}</span></div>
              <div>{e.title}</div>
              <div className="sub">{t(locale, "closes", { d: fmt(e.closesAt, locale) })}{e.state === "published" && e.closesAt && <> · <LiveClock closesAt={e.closesAt} locale={locale} /></>}</div>
              {e.state === "published" ? <Link className="btn" style={{ alignSelf: "flex-start" }} href={`/supplier/events/${e.id}`}>{t(locale, "openBid")}</Link> : e.outcome === "won" ? <div className="okbox">{t(locale, "awardedYou")}</div> : e.outcome === "lost" ? <div className="sub">{t(locale, "awardedOther")}</div> : <div className="sub">{t(locale, "closedForBids")}</div>}
            </div>
          ))}
      </main>
    </div>
  );
}
