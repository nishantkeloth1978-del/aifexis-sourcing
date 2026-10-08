import { redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import Shell from "@/ui/Shell";
import NewFromTemplate from "@/ui/NewFromTemplate";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { activeConfig, getProfile, listCategories } from "@/templates/service";

export const metadata = { title: "New event | Aifexis Sourcing" };

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const pool = getPool();
  const [cats, profile, cfg] = await Promise.all([listCategories(pool, s), getProfile(pool, s), activeConfig(pool, s)]);
  return <Shell title={tx(locale, "New event from a template")}><NewFromTemplate locale={locale} categories={cats} mine={profile.categories} configured={Boolean(cfg)} /></Shell>;
}
