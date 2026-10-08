import { redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import { getSession, getSupplierSession } from "@/lib/session";
import { signOut } from "../login/actions";

export const metadata = { title: "No access | Aifexis Sourcing" };

export default async function NoAccess() {
  if (await getSession()) redirect("/");
  if (await getSupplierSession()) redirect("/supplier");
  const locale = await getLocale();
  return (
    <div className="loginwrap"><div className="logincard">
      <div className="loginbrand"><b>AIFEXIS</b><span>Sourcing</span></div>
      <h1>{tx(locale, "No access")}</h1>
      <p className="sub">{tx(locale, "This sign-in is not linked to an organisation yet. If you were invited as a supplier, open your invitation link again. Otherwise ask your administrator to add you.")}</p>
      <form action={signOut}><button className="btn" type="submit">{tx(locale, "Sign out")}</button></form>
    </div></div>
  );
}
