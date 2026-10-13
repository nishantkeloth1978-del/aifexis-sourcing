import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import { getPool } from "@/lib/db";
import { staffInviteInfo } from "@/users/service";
import JoinForm from "../JoinForm";

export const metadata = { title: "Join | Aifexis Sourcing" };

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale = await getLocale();
  const info = await staffInviteInfo(getPool(), token);
  return (
    <div className="loginwrap"><div className="logincard">
      <div className="loginbrand"><b>AIFEXIS</b><span>Sourcing</span></div>
      {!info || info.expired ? (
        <><h1>{tx(locale, "Invitation not valid")}</h1><p className="sub">{tx(locale, "This link is not valid or has expired. Ask your administrator for a new one.")}</p></>
      ) : (
        <>
          <h1>{tx(locale, "Join your organisation")}</h1>
          <p className="sub">{tx(locale, "{tenant} has invited you to join as {role}.", { tenant: info.tenantName, role: tx(locale, info.role === "admin" ? "Administrator" : info.role === "integration_admin" ? "Integration administrator" : "Member") })}</p>
          <JoinForm locale={locale} token={token} email={info.email} />
        </>
      )}
    </div></div>
  );
}
