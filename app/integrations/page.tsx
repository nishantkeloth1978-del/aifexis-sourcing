import { redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import Shell from "@/ui/Shell";
import HandoverList from "@/ui/HandoverList";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listAwarded } from "@/handover/service";

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  return <Shell title={tx(locale, "Integrations")}><HandoverList locale={locale} rows={await listAwarded(getPool(), s)} /></Shell>;
}
