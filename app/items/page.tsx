import { redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import Shell from "@/ui/Shell";
import CatalogManager from "@/ui/CatalogManager";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listCatalog } from "@/catalog/service";

export const metadata = { title: "Items | Aifexis Sourcing" };

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const items = await listCatalog(getPool(), s, { limit: 2000 });
  return <Shell title={tx(locale, "Items")}><CatalogManager locale={locale} initial={items} canEdit={s.role === "admin" || s.role === "member"} /></Shell>;
}
