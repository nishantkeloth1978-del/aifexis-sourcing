import { getSupplierSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getBidForm } from "@/bids/service";
import { priceSheet } from "@/bids/sheet";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await getSupplierSession();
  if (!who) return new Response("Not found", { status: 404 });
  const form = await getBidForm(getPool(), who, id);
  if (!form) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(await priceSheet(form)), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${form.event.ref}-price-sheet.xlsx"`, "Cache-Control": "private, no-store" } });
}
