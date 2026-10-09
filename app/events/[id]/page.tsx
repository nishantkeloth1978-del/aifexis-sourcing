import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import EventDetailView from "@/ui/EventDetailView";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getLocale } from "@/i18n/server";
import { t } from "@/i18n/dict";
import { getEvent, listActivity } from "@/events/service";
import { workspaceOf } from "@/events/readiness";
import { getCommercialView } from "@/commercial/service";
import { bidAttachmentsForStaff, tenderDocsForStaff } from "@/files/service";
import { staffOverview } from "@/messages/service";
import StaffMessages from "@/ui/StaffMessages";
import { anonymousAliases, getEvalView } from "@/evaluation/service";
import { listCatalog } from "@/catalog/service";
import { listInvitations, listSuppliers } from "@/suppliers/service";
import TemplateInputsPanel from "@/ui/TemplateInputsPanel";
import { getEventTemplate } from "@/templates/events";
import FinalRoundPanel from "@/ui/FinalRoundPanel";
import { getRoundInfo } from "@/events/rounds";
import { getCancelInfo } from "@/events/cancel";
import { getReassignInfo } from "@/evaluation/reassign";
import CancelPanel from "@/ui/CancelPanel";
import ReassignPanel from "@/ui/ReassignPanel";
import { getJourney } from "@/journey/service";
import JourneyPanel from "@/ui/JourneyPanel";
import { listTeam, listTenantMembers, myEventRoles } from "@/events/workflow";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const locale = await getLocale();
  if (!s) redirect("/no-access");
  const pool = getPool();
  const event = await getEvent(pool, s, id);
  if (!event) notFound();
  const tplInfo = await getEventTemplate(pool, s, id);
  const showInv = event.state === "published";
  const [team, myRoles, people, suppliers, invitations] = await Promise.all([listTeam(pool, s, id), myEventRoles(pool, s, id), s.role === "admin" ? listTenantMembers(pool, s) : Promise.resolve([]), showInv ? listSuppliers(pool, s) : Promise.resolve([]), showInv ? listInvitations(pool, s, id) : Promise.resolve([])]);
  const evalView = ["draft", "pending_publication"].includes(event.state) ? null : await getEvalView(pool, s, id);
  const comView = ["technical_approved", "commercial_evaluation", "recommended", "pending_award", "awarded"].includes(event.state) ? await getCommercialView(pool, s, id) : null;
  const messages = await staffOverview(pool, s, id);
  const aliases = await anonymousAliases(pool, s, id);
  const [tenderDocs, bidFiles0] = await Promise.all([tenderDocsForStaff(pool, s, id), event.state === "draft" || event.state === "pending_publication" ? Promise.resolve([]) : bidAttachmentsForStaff(pool, s, id)]);
  const bidFiles = aliases ? bidFiles0.map((f) => ({ ...f, supplierName: f.supplierId ? aliases.get(f.supplierId) ?? "Bidder" : f.supplierName })) : bidFiles0;
  const cancelInfo = await getCancelInfo(pool, s, id);
  const reassign = ["draft", "pending_publication"].includes(event.state) ? null : await getReassignInfo(pool, s, id);
  const roundInfo = ["draft", "pending_publication"].includes(event.state) ? null : await getRoundInfo(pool, s, id);
  const journey = ["draft", "pending_publication"].includes(event.state) ? null : await getJourney(pool, s, id);
  const activity = await listActivity(pool, s, id);
  const workspace = workspaceOf({ state: event.state, title: event.title, closesAt: event.closesAt, itemCount: event.items.length, lotsNeeded: event.lots.length > 0, itemsWithLots: event.items.every((x) => x.lotId), teamRoles: team.map((m) => m.role), myRoles, isAdmin: s.role === "admin", docCount: tenderDocs.length });
  return (
    <Shell title={event.ref} action={<Link className="btn ghost" href="/">{t(locale, "backToEvents")}</Link>}>
      {tplInfo && <TemplateInputsPanel locale={locale} eventId={id} info={tplInfo} editable={event.state === "draft" && (s.role === "admin" || s.role === "member")} />}
      <EventDetailView locale={locale} event={event} team={team} myRoles={myRoles} people={people} isAdmin={s.role === "admin"} suppliers={suppliers} invitations={invitations} catalog={event.state === "draft" ? await listCatalog(pool, s, { activeOnly: true, limit: 2000 }) : []} evalView={evalView} comView={comView} clar={null} tenderDocs={tenderDocs} bidFiles={bidFiles} workspace={workspace} activity={activity} />
      {messages && (messages.phase !== "none" || messages.canWrite) && <StaffMessages locale={locale} eventId={id} initial={messages} />}
      {reassign && (reassign.canReassign || reassign.history.length > 0) && <ReassignPanel locale={locale} eventId={id} info={reassign} />}
      {cancelInfo && (cancelInfo.canCancel || cancelInfo.cancelledAt) && <CancelPanel locale={locale} eventId={id} version={event.stateVersion} info={cancelInfo} />}
      {journey && <JourneyPanel locale={locale} eventId={id} view={journey} />}
      {roundInfo && (roundInfo.canStart || roundInfo.rounds.length > 0) && <FinalRoundPanel locale={locale} eventId={id} version={event.stateVersion} info={roundInfo} />}
    </Shell>
  );
}
