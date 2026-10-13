import Shell from "@/ui/Shell";
import EventList from "@/ui/EventList";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listEvents, listTemplates } from "@/events/service";
import { myActions } from "@/dashboard/service";
import ActionsHome from "@/ui/ActionsHome";
import { redirect } from "next/navigation";
import { getLocale } from "@/i18n/server";
import { t } from "@/i18n/dict";

export default async function Home() {
  const s = await getSession();
  const locale = await getLocale();
  if (!s) redirect("/no-access");
  const [events, actions, templates] = await Promise.all([listEvents(getPool(), s), myActions(getPool(), s), listTemplates(getPool(), s)]);
  return (
    <Shell title={t(locale, "titleEvents")} action={<a className="btn ghost" href="/api/export/events">{t(locale, "exportExcel")}</a>}>
      <ActionsHome actions={actions} locale={locale} />
      <EventList events={events} templates={templates} locale={locale} />
    </Shell>
  );
}
