import { getPool } from "@/lib/db";
import { getSession, getSupplierSession } from "@/lib/session";
import { readFile } from "@/files/service";
import type { Actor } from "@/authz";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let tenantId: string | null = null, actor: Actor | null = null;
  const staff = await getSession();
  if (staff) { tenantId = staff.tenantId; actor = { kind: "internal", userId: staff.userId, tenantId: staff.tenantId }; }
  else {
    const sup = await getSupplierSession();
    if (sup) { tenantId = sup.tenantId; actor = { kind: "supplier", supplierUserId: sup.supplierUserId, tenantId: sup.tenantId }; }
  }
  const nf = () => new Response("Not found", { status: 404 });
  if (!tenantId || !actor) return nf();
  const f = await readFile(getPool(), tenantId, actor, id).catch(() => null);
  if (!f) return nf();
  return new Response(new Uint8Array(f.content), {
    headers: {
      "Content-Type": f.mime,
      "Content-Disposition": `attachment; filename="${f.filename.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
