import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import EventDetailView from "@/ui/EventDetailView";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getEvent } from "@/events/service";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const event = await getEvent(getPool(), s, id);
  if (!event) notFound();
  return (
    <Shell title={event.ref} action={<Link className="btn ghost" href="/">Back to events</Link>}>
      <EventDetailView event={event} />
    </Shell>
  );
}
