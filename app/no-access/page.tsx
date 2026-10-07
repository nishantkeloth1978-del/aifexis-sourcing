import { redirect } from "next/navigation";
import { getSession, getSupplierSession } from "@/lib/session";
import { signOut } from "../login/actions";

export const metadata = { title: "No access | Aifexis Sourcing" };

export default async function NoAccess() {
  if (await getSession()) redirect("/");
  if (await getSupplierSession()) redirect("/supplier");
  return (
    <div className="loginwrap"><div className="logincard">
      <div className="loginbrand"><b>AIFEXIS</b><span>Sourcing</span></div>
      <h1>No access</h1>
      <p className="sub">This sign-in is not linked to an organisation yet. If you were invited as a supplier, open your invitation link again. Otherwise ask your administrator to add you.</p>
      <form action={signOut}><button className="btn" type="submit">Sign out</button></form>
    </div></div>
  );
}
