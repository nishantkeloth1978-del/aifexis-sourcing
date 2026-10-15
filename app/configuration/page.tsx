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
import AssistantSettings from "@/ui/AssistantSettings";
import AutomationSettings from "@/ui/AutomationSettings";
import MonitorPanel from "@/ui/MonitorPanel";
import SapMappingPanel from "@/ui/SapMappingPanel";
import { getMapping } from "@/handover/sap";
import { getMonitor } from "@/automation/monitor";
import { getPolicy, recentActions } from "@/automation/policy";
import { lastRun } from "@/automation/service";
import ReaderEvalPanel from "@/ui/ReaderEvalPanel";
import IntegrationSettings from "@/ui/IntegrationSettings";
import { integrationScreen } from "@/integrations/service";
import { claudeFor, screenFor } from "@/assistant/models";

export const maxDuration = 60;

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const [{ config, version }, templates] = await Promise.all([getConfig(getPool(), s), listTemplates(getPool(), s)]);
  const ai = can(s, "config.manage") ? await getAiStatus(getPool(), undefined, (await claudeFor(getPool(), s.tenantId).catch(() => null)) !== null).catch(() => null) : null;
  const scan = can(s, "config.manage") ? await getScanStatus(getPool()).catch(() => null) : null;
  const sapMap = can(s, "config.manage") ? await getMapping(getPool(), s.tenantId).catch(() => null) : null;
  const monitor = can(s, "config.manage") ? await getMonitor(getPool(), s.tenantId).catch(() => null) : null;
  const automation = can(s, "config.manage") ? await Promise.all([getPolicy(getPool(), s.tenantId), recentActions(getPool(), s.tenantId), lastRun(getPool(), s.tenantId)]).catch(() => null) : null;
  const integrations = can(s, "integration.manage") ? await integrationScreen(getPool(), s).catch(() => null) : null;
  const assistant = can(s, "config.manage") ? await screenFor(getPool(), s.tenantId).catch(() => null) : null;
  return <Shell title={tx(locale, "Configuration")}>{ai && <AiStatusLine status={ai} locale={locale} />}{scan && <ScannerStatusLine status={scan} locale={locale} />}<ConfigForm locale={locale} initial={config} version={version} canEdit={can(s, "config.manage")} />{automation && <AutomationSettings locale={locale} policy={automation[0]} recent={automation[1]} last={automation[2]} />}{monitor && <MonitorPanel locale={locale} m={monitor} />}{can(s, "config.manage") && <SapMappingPanel locale={locale} initial={sapMap} />}{can(s, "config.manage") && <ReaderEvalPanel locale={locale} />}{integrations && <IntegrationSettings locale={locale} screen={integrations} />}{assistant && <AssistantSettings locale={locale} screen={assistant} />}<TemplateList locale={locale} initial={templates} canDelete={can(s, "template.manage")} /></Shell>;
}
