import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { previewPayload } from "@/handover/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return new Response("Not found", { status: 404 });
  const target = new URL(req.url).searchParams.get("target") === "ARIBA" ? "ARIBA" : "SAP";
  const r = await previewPayload(getPool(), s, id, target);
  if (!r.ok) return new Response("Not found", { status: 404 });
  return new Response(JSON.stringify(r.payload, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${r.payload.eventRef}-${target.toLowerCase()}.json"`, "Cache-Control": "private, no-store" } });
}
