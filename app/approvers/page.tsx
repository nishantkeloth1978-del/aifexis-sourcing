import { redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import Shell from "@/ui/Shell";
import ApproverRouting from "@/ui/ApproverRouting";
import ApprovalSimulator from "@/ui/ApprovalSimulator";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listRoutes } from "@/events/routing";
import { listTenantMembers } from "@/events/workflow";

export const metadata = { title: "Approvers | Aifexis Sourcing" };

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const pool = getPool();
  const [routes, people] = await Promise.all([listRoutes(pool, s), listTenantMembers(pool, s)]);
  return <Shell title={tx(locale, "Approvers")}><>{s.role === "admin" && <ApprovalSimulator locale={locale} />}<ApproverRouting locale={locale} routes={routes} people={people} canEdit={s.role === "admin"} /></></Shell>;
}
