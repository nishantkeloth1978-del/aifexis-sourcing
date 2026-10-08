import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import { getPool } from "@/lib/db";
import { invitationInfo } from "@/suppliers/service";
import InviteForm from "../InviteForm";

export const metadata = { title: "Invitation | Aifexis Sourcing" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale = await getLocale();
  const info = await invitationInfo(getPool(), token);
  return (
    <div className="loginwrap"><div className="logincard">
      <div className="loginbrand"><b>AIFEXIS</b><span>Sourcing</span></div>
      {!info || info.expired ? (
        <><h1>{tx(locale, "Invitation not valid")}</h1><p className="sub">{tx(locale, "This link is not valid or has expired. Ask the buyer to send a new one.")}</p></>
      ) : (
        <>
          <h1>{tx(locale, "You are invited")}</h1>
          <p className="sub">{tx(locale, "{tenant} invites {supplier} to bid on {ref}: {title}.", { tenant: info.tenantName, supplier: info.supplierName, ref: info.eventRef, title: info.eventTitle })}</p>
          <InviteForm locale={locale} token={token} email={info.contactEmail} />
        </>
      )}
    </div></div>
  );
}
