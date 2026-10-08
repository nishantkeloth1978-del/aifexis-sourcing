import LoginForm from "./LoginForm";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";

export const metadata = { title: "Sign in | Aifexis Sourcing" };

export default async function LoginPage() {
  const locale = await getLocale();
  return (
    <div className="loginwrap">
      <div className="logincard">
        <div className="loginbrand"><b>AIFEXIS</b><span>Sourcing</span></div>
        <h1>{tx(locale, "Sign in")}</h1>
        <LoginForm locale={locale} />
      </div>
    </div>
  );
}
