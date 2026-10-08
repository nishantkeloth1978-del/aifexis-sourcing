import { redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import Shell from "@/ui/Shell";
import CompanySetup from "@/ui/CompanySetup";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getProfile, listCategories, listIndustries, listPolicies, profileGaps } from "@/templates/service";

export const metadata = { title: "Company setup | Aifexis Sourcing" };

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const pool = getPool();
  const [profile, industries, categories, policies] = await Promise.all([getProfile(pool, s), listIndustries(pool, s), listCategories(pool, s), listPolicies(pool, s)]);
  const gaps = profileGaps(profile, policies.filter((p) => !p.confirmed).length);
  return <Shell title={tx(locale, "Company setup")}><CompanySetup locale={locale} profile={profile} industries={industries} categories={categories} policies={policies} gaps={gaps} canEdit={s.role === "admin"} /></Shell>;
}
