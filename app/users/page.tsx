import { redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import UsersPanel from "@/ui/UsersPanel";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listMembers } from "@/users/service";

export const metadata = { title: "Users | Aifexis Sourcing" };

export default async function UsersPage() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const r = await listMembers(getPool(), s);
  return (
    <Shell title={tx(locale, "Users")}>
      {r.ok ? <UsersPanel locale={locale} members={r.members} invites={r.invites} meId={s.membershipId} />
        : <div className="card"><p className="sub">{tx(locale, r.error)}</p></div>}
    </Shell>
  );
}
