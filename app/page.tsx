import Shell from "@/ui/Shell";
import EventList from "@/ui/EventList";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listEvents } from "@/events/service";
import { redirect } from "next/navigation";

export default async function Home() {
  const s = await getSession();
  if (!s) redirect("/login");
  const events = await listEvents(getPool(), s);
  return (
    <Shell title="Events">
      <EventList events={events} />
    </Shell>
  );
}
