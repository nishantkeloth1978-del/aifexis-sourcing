import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, getSupplierSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getBidForm } from "@/bids/service";
import { listForSupplier } from "@/clarifications/service";
import { listBidAttachments, tenderDocsForSupplier } from "@/files/service";
import { MyAttachments, TenderDocsList } from "@/ui/SupplierFiles";
import DocumentSlots from "@/ui/DocumentSlots";
import SupplierQuestions from "@/ui/SupplierQuestions";
import BidForm from "@/ui/BidForm";
import SubmissionCheck from "@/ui/SubmissionCheck";
import { feedbackForSupplier, validityForSupplier } from "@/journey/service";
import { signOut } from "../../../login/actions";
import { getLocale } from "@/i18n/server";
import { t } from "@/i18n/dict";
import { tx } from "@/i18n/tx";
import LangSwitch from "@/ui/LangSwitch";

export default async function SupplierEvent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const who = await getSupplierSession();
  if (!who) redirect((await getSession()) ? "/" : "/no-access");
  const form = await getBidForm(getPool(), who, id);
  if (!form) notFound();
  const [feedback, validUntil] = await Promise.all([feedbackForSupplier(getPool(), who, id), validityForSupplier(getPool(), who, id)]);
  const [threads, docs, mine] = await Promise.all([listForSupplier(getPool(), who, id), tenderDocsForSupplier(getPool(), who, id), listBidAttachments(getPool(), who, id)]);
  return (
    <div className="supwrap">
      <header className="suptop"><div><b>AIFEXIS</b><small>{who.supplierName}</small></div>
        <span><LangSwitch locale={locale} /> <form action={signOut} style={{ display: "inline" }}><button className="signout" type="submit">{t(locale, "signOut")}</button></form></span></header>
      <main className="supmain" id="main">
        <Link className="sublink" href="/supplier">{t(locale, "backInvitations")}</Link>
        {docs.length > 0 && <TenderDocsList locale={locale} files={docs} />}
        {validUntil && form.event.state !== "awarded" && <div className="sub">{tx(locale, "Your quote should remain valid until {date}.", { date: validUntil })}</div>}
        {feedback && <div className="bidcard"><b>{tx(locale, "Feedback from the buyer")}</b><div className="bidtext">{feedback.message}</div></div>}
        <BidForm form={form} locale={locale} />
        <SubmissionCheck locale={locale} eventId={id} currency={form.event.currency} />
        {form.questionnaire && <DocumentSlots locale={locale} eventId={id} documents={form.questionnaire.documents} files={mine} open={form.open} />}
        <MyAttachments locale={locale} eventId={id} files={mine.filter((f) => !f.docKey)} open={form.open} />
        <SupplierQuestions locale={locale} eventId={id} initial={threads} canAsk={form.open} />
      </main>
    </div>
  );
}
