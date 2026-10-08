import { timingSafeEqual } from "node:crypto";
import { getPool } from "@/lib/db";
import { tick } from "@/automation/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? ""), want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!authorised(req)) return new Response("Not found", { status: 404 });
  try { return Response.json(await tick(getPool())); } catch { return Response.json({ error: "tick failed" }, { status: 500 }); }
}
