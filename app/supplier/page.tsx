import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, getSupplierSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listInvitedEvents } from "@/suppliers/service";
import NoteList from "@/ui/NoteList";
import { listNotesForSupplierUser } from "@/notifications/service";
import { signOut } from "../login/actions";

export const metadata = { title: "Supplier portal | Aifexis Sourcing" };
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "No closing date");

export default async function SupplierPortal() {
  const who = await getSupplierSession();
  if (!who) redirect((await getSession()) ? "/" : "/no-access");
  const [events, notes] = await Promise.all([listInvitedEvents(getPool(), who), listNotesForSupplierUser(getPool(), who.tenantId, who.supplierUserId)]);
  return (
    <div className="supwrap">
      <header className="suptop"><div><b>AIFEXIS</b><small>{who.supplierName}</small></div>
        <form action={signOut}><button className="signout" type="submit">Sign out</button></form></header>
      <main className="supmain">
        <NoteList notes={notes} linkBase="/supplier/events" />
        <h2 style={{ margin: 0 }}>Your invitations</h2>
        {events.length === 0 ? <div className="card"><div className="sub">No open invitations right now.</div></div> :
          events.map((e) => (
            <div className="card" key={e.id}>
              <div className="row"><h3>{e.ref}</h3><span className="sub">{e.buyer}</span></div>
              <div>{e.title}</div>
              <div className="sub">Closes {fmt(e.closesAt)}</div>
              {e.state === "published" ? <Link className="btn" style={{ alignSelf: "flex-start" }} href={`/supplier/events/${e.id}`}>Open bid</Link> : e.outcome === "won" ? <div className="okbox">Awarded to you.</div> : e.outcome === "lost" ? <div className="sub">Awarded to another bidder.</div> : <div className="sub">Closed for bids.</div>}
            </div>
          ))}
      </main>
    </div>
  );
}
