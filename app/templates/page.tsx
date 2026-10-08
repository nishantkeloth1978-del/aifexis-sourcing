import { redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import Shell from "@/ui/Shell";
import TemplateLibrary from "@/ui/TemplateLibrary";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { activeConfig, listCategories, listIndustries, listLibrary, recommend } from "@/templates/service";

export const metadata = { title: "Templates | Aifexis Sourcing" };

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const pool = getPool();
  const [library, rec, cfg, industries, categories] = await Promise.all([listLibrary(pool, s), recommend(pool, s), activeConfig(pool, s), listIndustries(pool, s), listCategories(pool, s)]);
  const recommended = Object.fromEntries(rec.templates.map((t) => [t.key, t.reasons]));
  return <Shell title={tx(locale, "Templates")}>
    <TemplateLibrary locale={locale} library={library.map((t) => ({ ...t, reasons: recommended[t.key] ?? [] }))} version={cfg?.version ?? 0} fallback={rec.fallback} fallbackIndustry={rec.fallbackIndustry}
      industries={Object.fromEntries(industries.map((i) => [i.code, { en: i.en, ar: i.ar }]))} categories={Object.fromEntries(categories.map((c) => [c.code, { en: c.en, ar: c.ar }]))} canEdit={s.role === "admin"} />
  </Shell>;
}
