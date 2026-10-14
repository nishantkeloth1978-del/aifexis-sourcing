import { withinRate } from "@/lib/guard";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { can } from "@/access/permissions";
import { getEventTemplate } from "@/templates/events";
import { groupTemplate } from "@/templates/groupsheet";

export const dynamic = "force-dynamic";

/** The import sheet for one repeating group of an event's template, prefilled with the rows already entered. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s || !can(s, "event.create")) return new Response("Not found", { status: 404 });
  if (!(await withinRate(s.membershipId, "exp", 30))) return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  const info = await getEventTemplate(getPool(), s, id).catch(() => null);
  const key = new URL(req.url).searchParams.get("group");
  const group = info?.effective.pricing.groups.find((g) => g.key === key);
  if (!info || !group) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(await groupTemplate(group, info.inputs.groups[group.key] ?? [])), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${group.key}-import-sheet.xlsx"`, "Cache-Control": "private, no-store" } });
}
