import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import EventDetailView from "@/ui/EventDetailView";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getEvent } from "@/events/service";
import { listTeam, listTenantMembers, myEventRoles } from "@/events/workflow";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const pool = getPool();
  const event = await getEvent(pool, s, id);
  if (!event) notFound();
  const [team, myRoles, people] = await Promise.all([listTeam(pool, s, id), myEventRoles(pool, s, id), s.role === "admin" ? listTenantMembers(pool, s) : Promise.resolve([])]);
  return (
    <Shell title={event.ref} action={<Link className="btn ghost" href="/">Back to events</Link>}>
      <EventDetailView event={event} team={team} myRoles={myRoles} people={people} isAdmin={s.role === "admin"} />
    </Shell>
  );
}
