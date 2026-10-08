import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { rawTemplate } from "@/templates/custom";
import { templateWorkbook } from "@/templates/sheet";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const s = await getSession();
  if (!s || s.role !== "admin") return new NextResponse("Not allowed", { status: 403 });
  const { key } = await params;
  const t = /^[A-Z0-9_]{1,80}$/.test(key) ? await rawTemplate(getPool(), s, key) : null;
  if (!t) return new NextResponse("Not found", { status: 404 });
  const meta = t.own ? t.meta : { ...t.meta, key: `CO_${t.meta.key}`.slice(0, 64) };
  return new NextResponse(new Uint8Array(await templateWorkbook(meta, t.content)), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${t.meta.key}_v${t.version}.xlsx"`, "Cache-Control": "private, no-store" } });
}
