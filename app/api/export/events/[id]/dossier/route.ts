import { withinRate } from "@/lib/guard";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getEvent, listActivity } from "@/events/service";
import { getCommercialView } from "@/commercial/service";
import { getJourney } from "@/journey/service";
import { listTeam } from "@/events/workflow";

export const dynamic = "force-dynamic";

/** One JSON file with the event record: details, lines, team, recommendation, validity, feedback status and activity. For buyers, approvers and auditors. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return new Response("Not found", { status: 404 });
  if (!(await withinRate(s.membershipId, "exp", 30))) return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  const pool = getPool();
  const e = await getEvent(pool, s, id).catch(() => null);
  const com = e ? await getCommercialView(pool, s, id).catch(() => null) : null;
  if (!e || !com || !com.roles.some((r) => ["buyer", "award_approver", "auditor"].includes(r))) return new Response("Not found", { status: 404 });
  const [team, activity, journey] = await Promise.all([listTeam(pool, s, id), listActivity(pool, s, id, 500), getJourney(pool, s, id)]);
  const body = { exportedAt: new Date().toISOString(), event: { ref: e.ref, title: e.title, state: e.state, ownerDept: e.ownerDept, closesAt: e.closesAt, currency: e.currency, valueAed: e.valueAed },
    lots: e.lots, items: e.items, team: team.map((m) => ({ email: m.email, role: m.role })),
    comparison: com.comparison, recommendation: com.recommendation, lotAwards: com.lotAwards, approvals: com.approvals,
    quoteValidity: journey ? { days: journey.validityDays, until: journey.baseUntil, bidders: journey.bidders } : null,
    feedback: journey?.debriefs.map((d) => ({ supplier: d.name, sent: Boolean(d.released), at: d.releasedAt })) ?? [], activity };
  return new Response(JSON.stringify(body, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${e.ref}-dossier.json"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
