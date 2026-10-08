import { redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import Shell from "@/ui/Shell";
import TemplateEditor from "@/ui/TemplateEditor";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { rawTemplate } from "@/templates/custom";
import { listCategories } from "@/templates/service";
import type { TemplateContent } from "@/templates/types";

export const metadata = { title: "Template editor | Aifexis Sourcing" };
const BLANK: TemplateContent = { schema: 1, sections: [], fields: [], questions: [], documents: [], pricing: { model: "itemized", groups: [], lines: [] }, evaluation: { modes: ["price", "manual"], mode: "price", scale: { min: 0, max: 5 }, criteria: [] }, workflow: [] };

export default async function Page({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const { key } = await searchParams;
  const pool = getPool();
  const [cats, t] = await Promise.all([listCategories(pool, s), key && /^[A-Z0-9_]{1,80}$/.test(key) ? rawTemplate(pool, s, key) : Promise.resolve(null)]);
  const initial = t ?? { meta: { key: "CO_", title: { en: "", ar: "" }, category: "GENERAL", eventType: "RFQ" as const }, version: 0, content: BLANK, own: true };
  return <Shell title={tx(locale, "Template editor")}><TemplateEditor key={key ?? "new"} locale={locale} initial={initial} categories={cats} canEdit={s.role === "admin"} /></Shell>;
}
