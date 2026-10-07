import { getPool } from "@/lib/db";
import { invitationInfo } from "@/suppliers/service";
import InviteForm from "../InviteForm";

export const metadata = { title: "Invitation | Aifexis Sourcing" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await invitationInfo(getPool(), token);
  return (
    <div className="loginwrap"><div className="logincard">
      <div className="loginbrand"><b>AIFEXIS</b><span>Sourcing</span></div>
      {!info || info.expired ? (
        <><h1>Invitation not valid</h1><p className="sub">This link is not valid or has expired. Ask the buyer to send a new one.</p></>
      ) : (
        <>
          <h1>You are invited</h1>
          <p className="sub"><b>{info.tenantName}</b> invites <b>{info.supplierName}</b> to bid on <b>{info.eventRef}</b>: {info.eventTitle}.</p>
          <InviteForm token={token} email={info.contactEmail} />
        </>
      )}
    </div></div>
  );
}
