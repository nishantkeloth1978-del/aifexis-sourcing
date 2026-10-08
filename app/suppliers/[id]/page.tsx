import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import Shell from "@/ui/Shell";
import SupplierProfileForm from "@/ui/SupplierProfileForm";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { supplierProfile } from "@/suppliers/master";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const data = await supplierProfile(getPool(), s, id);
  if (!data) notFound();
  return <Shell title={data.supplier.name} action={<Link className="btn ghost" href="/suppliers">{tx(locale, "Back to suppliers")}</Link>}><SupplierProfileForm locale={locale} data={data} canEdit={s.role === "admin" || s.role === "member"} /></Shell>;
}
