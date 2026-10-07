import { redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import SupplierList from "@/ui/SupplierList";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listSuppliers } from "@/suppliers/service";

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const suppliers = await listSuppliers(getPool(), s);
  return <Shell title="Suppliers"><SupplierList initial={suppliers} canAdd={s.role === "admin" || s.role === "member"} /></Shell>;
}
