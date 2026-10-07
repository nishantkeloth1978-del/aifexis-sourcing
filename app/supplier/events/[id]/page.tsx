import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, getSupplierSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getBidForm } from "@/bids/service";
import BidForm from "@/ui/BidForm";
import { signOut } from "../../../login/actions";

export default async function SupplierEvent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await getSupplierSession();
  if (!who) redirect((await getSession()) ? "/" : "/no-access");
  const form = await getBidForm(getPool(), who, id);
  if (!form) notFound();
  return (
    <div className="supwrap">
      <header className="suptop"><div><b>AIFEXIS</b><small>{who.supplierName}</small></div>
        <form action={signOut}><button className="signout" type="submit">Sign out</button></form></header>
      <main className="supmain">
        <Link className="sublink" href="/supplier">&larr; Your invitations</Link>
        <BidForm form={form} />
      </main>
    </div>
  );
}
