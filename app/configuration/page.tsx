import { redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import Shell from "@/ui/Shell";
import ConfigForm from "@/ui/ConfigForm";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getConfig } from "@/config/service";
import { listTemplates } from "@/events/service";
import TemplateList from "@/ui/TemplateList";

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const [{ config, version }, templates] = await Promise.all([getConfig(getPool(), s), listTemplates(getPool(), s)]);
  return <Shell title={tx(locale, "Configuration")}><ConfigForm locale={locale} initial={config} version={version} canEdit={s.role === "admin"} /><TemplateList locale={locale} initial={templates} canDelete={s.role === "admin"} /></Shell>;
}
