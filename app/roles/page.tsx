import { redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import RolesPanel from "@/ui/RolesPanel";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listRoles } from "@/access/roles";
import { listMembers } from "@/users/service";

export const metadata = { title: "Roles | Aifexis Sourcing" };

export default async function RolesPage() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const r = await listRoles(getPool(), s);
  const m = await listMembers(getPool(), s);
  return (
    <Shell title={tx(locale, "Roles and permissions")}>
      {r.ok ? <RolesPanel locale={locale} roles={r.roles} people={m.ok ? m.members.filter((x) => x.active).map((x) => ({ id: x.membershipId, email: x.email })) : []} />
        : <div className="card"><p className="sub">{tx(locale, r.error)}</p></div>}
    </Shell>
  );
}
