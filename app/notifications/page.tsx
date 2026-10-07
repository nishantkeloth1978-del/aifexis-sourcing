import { redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import NoteList from "@/ui/NoteList";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listNotes } from "@/notifications/service";

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const notes = await listNotes(getPool(), s.tenantId, s.userId);
  return <Shell title="Notifications"><NoteList notes={notes} linkBase="/events" /></Shell>;
}
