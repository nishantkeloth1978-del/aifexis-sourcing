import { getSession } from "@/lib/session";
import { suppliersTemplate } from "@/suppliers/sheet";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getSession())) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(await suppliersTemplate()), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="suppliers-template.xlsx"', "Cache-Control": "private, no-store" } });
}
