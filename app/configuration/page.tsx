import { can } from "@/access/permissions";
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
import AiStatusLine from "@/ui/AiStatusLine";
import { getAiStatus } from "@/lib/aistatus";
import ScannerStatusLine from "@/ui/ScannerStatusLine";
import { getScanStatus } from "@/lib/scanstatus";

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const [{ config, version }, templates] = await Promise.all([getConfig(getPool(), s), listTemplates(getPool(), s)]);
  const ai = can(s, "config.manage") ? await getAiStatus(getPool()).catch(() => null) : null;
  const scan = can(s, "config.manage") ? await getScanStatus(getPool()).catch(() => null) : null;
  return <Shell title={tx(locale, "Configuration")}>{ai && <AiStatusLine status={ai} locale={locale} />}{scan && <ScannerStatusLine status={scan} locale={locale} />}<ConfigForm locale={locale} initial={config} version={version} canEdit={can(s, "config.manage")} /><TemplateList locale={locale} initial={templates} canDelete={can(s, "template.manage")} /></Shell>;
}
