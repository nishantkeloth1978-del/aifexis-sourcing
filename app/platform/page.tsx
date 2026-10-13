import { notFound } from "next/navigation";
import PlatformConsole from "@/ui/PlatformConsole";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import { getPlatformUser } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listTenants } from "@/platform/service";

export const metadata = { title: "Platform | Aifexis Sourcing" };

export default async function PlatformPage() {
  if (!(await getPlatformUser())) notFound();
  const locale = await getLocale();
  const tenants = await listTenants(getPool());
  return (
    <div className="content" style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1>{tx(locale, "Platform: organisations")}</h1>
      <PlatformConsole locale={locale} tenants={tenants} />
    </div>
  );
}
