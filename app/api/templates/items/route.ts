import { getSession } from "@/lib/session";
import { itemsTemplate } from "@/events/sheet";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getSession())) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(await itemsTemplate()), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="rfq-items-template.xlsx"', "Cache-Control": "private, no-store" } });
}
