import { withinRate } from "@/lib/guard";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { awardsReport } from "@/reports/service";
import { csvResponse, toCsv } from "@/export/csv";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s) return new Response("Not found", { status: 404 });
  if (!(await withinRate(s.membershipId, "exp", 30))) return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  const r = await awardsReport(getPool(), s);
  return csvResponse("awards.csv", toCsv([["Reference", "Title", "Supplier", "Currency", "Awarded total", "Estimate (AED)", "Saving (AED)", "Saving %", "Awarded (UTC)"],
    ...r.rows.map((x) => [x.ref, x.title, x.supplier, x.currency, x.total, x.estimate, x.saving, x.savingPct, x.awardedAt])]));
}
