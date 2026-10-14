import Shell from "@/ui/Shell";
import EventList from "@/ui/EventList";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listEventsPage, listTemplates } from "@/events/service";
import { GROUP_STATES } from "@/events/groups";
import { myActions } from "@/dashboard/service";
import ActionsHome from "@/ui/ActionsHome";
import { redirect } from "next/navigation";
import { getLocale } from "@/i18n/server";
import { t } from "@/i18n/dict";

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  const locale = await getLocale();
  if (!s) redirect("/no-access");
  const q = (sp.q ?? "").slice(0, 100), status = sp.status && GROUP_STATES[sp.status] ? sp.status : "";
  const [events, actions, templates] = await Promise.all([listEventsPage(getPool(), s, { q, group: status, page: Number(sp.page) || 1 }), myActions(getPool(), s), listTemplates(getPool(), s)]);
  return (
    <Shell title={t(locale, "titleEvents")} action={<a className="btn ghost" href="/api/export/events">{t(locale, "exportExcel")}</a>}>
      <ActionsHome actions={actions} locale={locale} />
      <EventList page={events} q={q} status={status} templates={templates} locale={locale} />
    </Shell>
  );
}
