import { can } from "@/access/permissions";
import { redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import Shell from "@/ui/Shell";
import TemplateLibrary from "@/ui/TemplateLibrary";
import TemplateDefaults from "@/ui/TemplateDefaults";
import { listDefaults } from "@/templates/defaults";
import CompanyTemplates from "@/ui/CompanyTemplates";
import TemplateApproval from "@/ui/TemplateApproval";
import { approvalRequired, listPendingTemplates } from "@/templates/approval";
import TemplateLifecycle from "@/ui/TemplateLifecycle";
import { configHistory, listUpdates } from "@/templates/lifecycle";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { activeConfig, listCategories, listIndustries, listLibrary, recommend } from "@/templates/service";

export const metadata = { title: "Templates | Aifexis Sourcing" };

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const pool = getPool();
  const [library, rec, cfg, industries, categories, updates, history, defaults] = await Promise.all([listLibrary(pool, s), recommend(pool, s), activeConfig(pool, s), listIndustries(pool, s), listCategories(pool, s), listUpdates(pool, s), configHistory(pool, s), listDefaults(pool, s)]);
  const [apprReq, pendingTpl] = await Promise.all([approvalRequired(pool, s), listPendingTemplates(pool, s)]);
  const recommended = Object.fromEntries(rec.templates.map((t) => [t.key, t.reasons]));
  return <Shell title={tx(locale, "Templates")}>
    {can(s, "template.manage") && <CompanyTemplates locale={locale} categories={categories} library={library.map((t) => ({ key: t.key, title: t.title }))} />}
    {can(s, "template.approve") && <TemplateApproval locale={locale} required={apprReq} pending={pendingTpl} />}
    <TemplateDefaults locale={locale} library={library.map((t) => ({ key: t.key, title: t.title, eventType: t.eventType, enabled: t.enabled, missing: t.missing }))} defaults={defaults} categories={categories.map((c) => ({ code: c.code, en: c.en }))} canEdit={can(s, "template.manage")} />
    <TemplateLifecycle locale={locale} updates={updates} history={history} version={cfg?.version ?? 0} canEdit={can(s, "template.manage")} />
    <TemplateLibrary locale={locale} library={library.map((t) => ({ ...t, reasons: recommended[t.key] ?? [] }))} version={cfg?.version ?? 0} fallback={rec.fallback} fallbackIndustry={rec.fallbackIndustry}
      industries={Object.fromEntries(industries.map((i) => [i.code, { en: i.en, ar: i.ar }]))} categories={Object.fromEntries(categories.map((c) => [c.code, { en: c.en, ar: c.ar }]))} canEdit={can(s, "template.manage")} />
  </Shell>;
}
