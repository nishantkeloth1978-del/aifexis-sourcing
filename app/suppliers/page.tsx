import { can } from "@/access/permissions";
import { redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import Shell from "@/ui/Shell";
import SupplierList from "@/ui/SupplierList";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listSuppliers } from "@/suppliers/service";
import { getRegistration, listApplications } from "@/suppliers/registration";
import VendorApplications from "@/ui/VendorApplications";

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const suppliers = await listSuppliers(getPool(), s);
  const manage = can(s, "supplier.manage");
  const [registration, applications] = manage ? await Promise.all([getRegistration(getPool(), s), listApplications(getPool(), s)]) : [null, []];
  return <Shell title={tx(locale, "Suppliers")}><SupplierList locale={locale} initial={suppliers} canAdd={manage} />{manage && <VendorApplications locale={locale} registration={registration} applications={applications} />}</Shell>;
}
