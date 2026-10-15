import { withinRate } from "@/lib/guard";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listRequests } from "@/requests/service";
import { csvResponse, toCsv } from "@/export/csv";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s) return new Response("Not found", { status: 404 });
  if (!(await withinRate(s.membershipId, "exp", 30))) return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  const rows = await listRequests(getPool(), s);
  return csvResponse("requests.csv", toCsv([["Reference", "Source", "Type", "Title", "Requested by", "Status", "Needed by", "Estimated value", "Currency", "Event", "Raised (UTC)"],
    ...rows.map((r) => [r.ref, r.source, r.kind, r.title, r.requester, r.state, r.neededBy, r.estValue, r.currency, r.eventRef, r.createdAt])]));
}
