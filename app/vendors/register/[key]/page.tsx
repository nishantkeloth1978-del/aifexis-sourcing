import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import { getPool } from "@/lib/db";
import { vendorRegInfo } from "@/suppliers/registration";
import RegisterForm from "../RegisterForm";

export const metadata = { title: "Supplier registration | Aifexis Sourcing" };

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const locale = await getLocale();
  const info = await vendorRegInfo(getPool(), key).catch(() => null);
  return (
    <div className="loginwrap" role="main" id="main" tabIndex={-1}><div className="logincard" style={{ maxWidth: 560 }}>
      <div className="loginbrand"><b>AIFEXIS</b><span>Sourcing</span></div>
      {!info ? (
        <><h1>{tx(locale, "Registration not available")}</h1><p className="sub">{tx(locale, "This registration link is not valid or has been switched off.")}</p></>
      ) : (
        <>
          <h1>{tx(locale, "Register as a supplier")}</h1>
          <p className="sub">{tx(locale, "Tell {tenant} about your company. After approval you can be invited to tenders.", { tenant: info.tenantName })}</p>
          <RegisterForm locale={locale} regKey={key} />
        </>
      )}
    </div></div>
  );
}
