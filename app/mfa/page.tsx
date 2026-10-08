import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import ChallengeForm from "./ChallengeForm";

export const metadata = { title: "Confirm sign-in | Aifexis Sourcing" };

export default async function MfaPage() {
  const locale = await getLocale();
  return (
    <div className="loginwrap"><div className="logincard">
      <div className="loginbrand"><b>AIFEXIS</b><span>Sourcing</span></div>
      <h1>{tx(locale, "Confirm your sign-in")}</h1>
      <p className="sub">{tx(locale, "Open your authenticator app and enter the 6-digit code.")}</p>
      <ChallengeForm locale={locale} />
    </div></div>
  );
}
