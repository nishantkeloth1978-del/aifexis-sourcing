import { withinRate } from "@/lib/guard";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { previewPayload } from "@/handover/service";
import { previewSap } from "@/handover/sap-service";
import { sapCsv } from "@/handover/sap";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return new Response("Not found", { status: 404 });
  if (!(await withinRate(s.membershipId, "exp", 30))) return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  const target = new URL(req.url).searchParams.get("target") === "ARIBA" ? "ARIBA" : "SAP";
  const supplier = new URL(req.url).searchParams.get("supplier") ?? undefined;
  const format = new URL(req.url).searchParams.get("format");
  if (format === "sap-po" || format === "sap-csv") {
    const x = await previewSap(getPool(), s, id, supplier);
    if (!x.ok) return new Response("Not found", { status: 404 });
    const bad = x.docs.flatMap((d) => (d.ok ? [] : d.errors.map((e) => `${d.supplier}: ${e}`)));
    if (bad.length) return new Response(JSON.stringify({ errors: bad }, null, 2), { status: 422, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
    const docs = x.docs.flatMap((d) => (d.ok ? [d.document] : []));
    const csv = format === "sap-csv";
    return new Response(csv ? sapCsv(docs) : JSON.stringify(docs.length === 1 ? docs[0] : docs, null, 2), { headers: { "Content-Type": csv ? "text/csv; charset=utf-8" : "application/json", "Content-Disposition": `attachment; filename="${x.ref}-sap-po.${csv ? "csv" : "json"}"`, "Cache-Control": "private, no-store" } });
  }
  const r = await previewPayload(getPool(), s, id, target, supplier);
  if (!r.ok) return new Response("Not found", { status: 404 });
  return new Response(JSON.stringify(r.payloads.length === 1 ? r.payload : r.payloads, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${r.payload.eventRef}-${target.toLowerCase()}.json"`, "Cache-Control": "private, no-store" } });
}
