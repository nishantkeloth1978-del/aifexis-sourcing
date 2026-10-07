import Shell from "@/ui/Shell";
import EventList from "@/ui/EventList";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listEvents } from "@/events/service";
import { myTasks } from "@/dashboard/service";
import TaskList from "@/ui/TaskList";
import { redirect } from "next/navigation";

export default async function Home() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const [events, tasks] = await Promise.all([listEvents(getPool(), s), myTasks(getPool(), s)]);
  return (
    <Shell title="Events" action={<a className="btn ghost" href="/api/export/events">Export to Excel</a>}>
      <TaskList tasks={tasks} />
      <EventList events={events} />
    </Shell>
  );
}
