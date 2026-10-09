import { getPool } from "@/lib/db";
import { getSession, getSupplierSession } from "@/lib/session";
import { withinRate } from "@/lib/guard";
import { readMessageFile } from "@/messages/service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nf = () => new Response("Not found", { status: 404 });
  const staff = await getSession();
  const sup = staff ? null : await getSupplierSession();
  if (!staff && !sup) return nf();
  if (!(await withinRate(staff ? staff.userId : sup!.supplierUserId, "dl", 120))) return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  const f = await readMessageFile(getPool(), staff ? { staff } : { supplier: sup! }, id).catch(() => null);
  if (!f) return nf();
  return new Response(new Uint8Array(f.content), { headers: { "Content-Type": f.mime, "Content-Disposition": `attachment; filename="${f.filename.replace(/"/g, "")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
