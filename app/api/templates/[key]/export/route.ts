import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { previewEffective } from "@/templates/lifecycle";

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const s = await getSession();
  if (!s || s.role !== "admin") return new NextResponse("Not allowed", { status: 403 });
  const { key } = await params;
  const p = /^[A-Z0-9_]{1,80}$/.test(key) ? await previewEffective(getPool(), s, key) : null;
  if (!p) return new NextResponse("Not found", { status: 404 });
  const body = JSON.stringify({ template: key, version: p.version, hash: p.hash, content: p.effective }, null, 2);
  return new NextResponse(body, { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${key}_v${p.version}.json"` } });
}
