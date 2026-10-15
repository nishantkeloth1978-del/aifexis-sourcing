import { redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import Shell from "@/ui/Shell";
import RequestImport from "@/ui/RequestImport";
import { getSession } from "@/lib/session";
import { can } from "@/access/permissions";

export const metadata = { title: "Import requests | Aifexis Sourcing" };

export default async function Page() {
  const s = await getSession();
  if (!s || !can(s, "request.create")) redirect("/no-access");
  const locale = await getLocale();
  return <Shell title={tx(locale, "Import requests")}><RequestImport locale={locale} /></Shell>;
}
