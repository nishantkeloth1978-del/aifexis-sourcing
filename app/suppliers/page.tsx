import { redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import Shell from "@/ui/Shell";
import SupplierList from "@/ui/SupplierList";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listSuppliers } from "@/suppliers/service";

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const suppliers = await listSuppliers(getPool(), s);
  return <Shell title={tx(locale, "Suppliers")}><SupplierList locale={locale} initial={suppliers} canAdd={s.role === "admin" || s.role === "member"} /></Shell>;
}
