import { withinRate } from "@/lib/guard";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listEvents } from "@/events/service";
import { csvResponse, toCsv } from "@/export/csv";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s) return new Response("Not found", { status: 404 });
  if (!(await withinRate(s.membershipId, "exp", 30))) return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  const ev = await listEvents(getPool(), s);
  const rows = [["Reference", "Title", "Department", "Status", "Currency", "Closing date (UTC)", "Created (UTC)"],
    ...ev.map((e) => [e.ref, e.title, e.ownerDept, e.state, e.currency, e.closesAt ?? "", e.createdAt])];
  return csvResponse("events.csv", toCsv(rows));
}
