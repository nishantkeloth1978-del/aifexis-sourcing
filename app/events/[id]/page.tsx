import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import EventDetailView from "@/ui/EventDetailView";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getLocale } from "@/i18n/server";
import { t } from "@/i18n/dict";
import { getEvent } from "@/events/service";
import { getCommercialView } from "@/commercial/service";
import { bidAttachmentsForStaff, tenderDocsForStaff } from "@/files/service";
import { listForStaff } from "@/clarifications/service";
import { getEvalView } from "@/evaluation/service";
import { listInvitations, listSuppliers } from "@/suppliers/service";
import { listTeam, listTenantMembers, myEventRoles } from "@/events/workflow";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const locale = await getLocale();
  if (!s) redirect("/no-access");
  const pool = getPool();
  const event = await getEvent(pool, s, id);
  if (!event) notFound();
  const showInv = event.state === "published";
  const [team, myRoles, people, suppliers, invitations] = await Promise.all([listTeam(pool, s, id), myEventRoles(pool, s, id), s.role === "admin" ? listTenantMembers(pool, s) : Promise.resolve([]), showInv ? listSuppliers(pool, s) : Promise.resolve([]), showInv ? listInvitations(pool, s, id) : Promise.resolve([])]);
  const evalView = ["draft", "pending_publication"].includes(event.state) ? null : await getEvalView(pool, s, id);
  const comView = ["technical_approved", "commercial_evaluation", "recommended", "pending_award", "awarded"].includes(event.state) ? await getCommercialView(pool, s, id) : null;
  const clar = ["draft", "pending_publication"].includes(event.state) ? null : await listForStaff(pool, s, id);
  const [tenderDocs, bidFiles] = await Promise.all([tenderDocsForStaff(pool, s, id), event.state === "draft" || event.state === "pending_publication" ? Promise.resolve([]) : bidAttachmentsForStaff(pool, s, id)]);
  return (
    <Shell title={event.ref} action={<Link className="btn ghost" href="/">{t(locale, "backToEvents")}</Link>}>
      <EventDetailView locale={locale} event={event} team={team} myRoles={myRoles} people={people} isAdmin={s.role === "admin"} suppliers={suppliers} invitations={invitations} evalView={evalView} comView={comView} clar={clar} tenderDocs={tenderDocs} bidFiles={bidFiles} />
    </Shell>
  );
}
