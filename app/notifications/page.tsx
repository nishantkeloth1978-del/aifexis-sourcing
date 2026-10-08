import { redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import NoteList from "@/ui/NoteList";
import { getLocale } from "@/i18n/server";
import { t } from "@/i18n/dict";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listNotes } from "@/notifications/service";

export default async function Page() {
  const s = await getSession();
  const locale = await getLocale();
  if (!s) redirect("/no-access");
  const notes = await listNotes(getPool(), s.tenantId, s.userId);
  return <Shell title={t(locale, "titleNotifications")}><NoteList notes={notes} linkBase="/events" locale={locale} /></Shell>;
}
