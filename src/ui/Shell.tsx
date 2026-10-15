import { can } from "@/access/permissions";
import Nav from "./Nav";
import { getLowAssuranceSession as getSession } from "@/lib/session";
import { signOut } from "../../app/login/actions";
import Link from "next/link";
import { getPool } from "@/lib/db";
import { unreadCount } from "@/notifications/service";
import { getLocale } from "@/i18n/server";
import { t } from "@/i18n/dict";
import LangSwitch from "./LangSwitch";
import { tx } from "@/i18n/tx";
import { pendingCount } from "@/decisions/service";
import { isPlatformAdmin } from "@/platform/service";
import AssistantPanel from "./AssistantPanel";
import { assistantEnabled } from "@/assistant/models";
import { after } from "next/server";
import { pageTick } from "@/automation/service";

export default async function Shell({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const s = await getSession();
  const locale = await getLocale();
  const unread = s ? await unreadCount(getPool(), s.tenantId, s.userId).catch(() => 0) : 0;
  const confirmations = s ? await pendingCount(getPool(), s).catch(() => 0) : 0;
  const name = s ? (s.email.split("@")[0] ?? "") : "";
  if (s) after(() => pageTick(getPool(), s.tenantId));   // backup clock: runs after the page is sent, only if the last run was over a minute ago
  const asstOn = s ? await assistantEnabled(getPool(), s.tenantId).catch(() => false) : false;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><b>AIFEXIS</b><span>{s?.tenantName ?? "Sourcing"}</span></div>
        <Nav locale={locale} admin={s ? can(s, "users.manage") : false} roles={s ? can(s, "roles.manage") : false} platform={isPlatformAdmin(s?.email)} confirmations={confirmations} />
        <div className="user">
          <div className="avatar">{name.charAt(0).toUpperCase()}</div>
          <div>{name}<small>{s?.role}</small>
            <form action={signOut}><button className="signout" type="submit">{t(locale, "signOut")}</button></form>
            <Link className="signout" href="/security">{tx(locale, "Security")}</Link>
            <Link className="signout" href="/settings">{tx(locale, "Settings")}</Link>
            <LangSwitch locale={locale} />
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="top"><h1>{title}</h1><span className="topright">{action}{s && asstOn && <AssistantPanel locale={locale} />}<Link className="bell" href="/notifications" aria-label={`${t(locale, "notifications")}, ${unread}`}>{t(locale, "notifications")}{unread > 0 && <b>{unread}</b>}</Link></span></header>
        <main className="content" id="main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
