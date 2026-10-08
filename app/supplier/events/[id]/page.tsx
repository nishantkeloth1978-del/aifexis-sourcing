import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, getSupplierSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getBidForm } from "@/bids/service";
import { listForSupplier } from "@/clarifications/service";
import { listBidAttachments, tenderDocsForSupplier } from "@/files/service";
import { MyAttachments, TenderDocsList } from "@/ui/SupplierFiles";
import SupplierQuestions from "@/ui/SupplierQuestions";
import BidForm from "@/ui/BidForm";
import { signOut } from "../../../login/actions";
import { getLocale } from "@/i18n/server";
import { t } from "@/i18n/dict";
import LangSwitch from "@/ui/LangSwitch";

export default async function SupplierEvent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const who = await getSupplierSession();
  if (!who) redirect((await getSession()) ? "/" : "/no-access");
  const form = await getBidForm(getPool(), who, id);
  if (!form) notFound();
  const [threads, docs, mine] = await Promise.all([listForSupplier(getPool(), who, id), tenderDocsForSupplier(getPool(), who, id), listBidAttachments(getPool(), who, id)]);
  return (
    <div className="supwrap">
      <header className="suptop"><div><b>AIFEXIS</b><small>{who.supplierName}</small></div>
        <span><LangSwitch locale={locale} /> <form action={signOut} style={{ display: "inline" }}><button className="signout" type="submit">{t(locale, "signOut")}</button></form></span></header>
      <main className="supmain">
        <Link className="sublink" href="/supplier">{t(locale, "backInvitations")}</Link>
        {docs.length > 0 && <TenderDocsList files={docs} />}
        <BidForm form={form} locale={locale} />
        <MyAttachments eventId={id} files={mine} open={form.open} />
        <SupplierQuestions eventId={id} initial={threads} canAsk={form.open} />
      </main>
    </div>
  );
}
