import { getSession } from "@/lib/session";
import { catalogTemplate } from "@/catalog/sheet";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getSession())) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(await catalogTemplate()), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="item-catalogue-template.xlsx"', "Cache-Control": "private, no-store" } });
}
