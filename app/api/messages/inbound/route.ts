import { timingSafeEqual } from "node:crypto";
import { getPool } from "@/lib/db";
import { clientIp } from "@/lib/guard";
import { allow } from "@/lib/ratelimit";
import { handleInbound, parseInbound } from "@/messages/inbound";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorised(req: Request): boolean {
  const secret = process.env.MESSAGES_INBOUND_SECRET;
  if (!secret) return false;
  const given = req.headers.get("x-inbound-secret") ?? new URL(req.url).searchParams.get("key") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The mail provider posts each reply here. Always answers 200 for a well-formed call so the provider does not retry a reply we refused on purpose. */
export async function POST(req: Request) {
  if (!authorised(req)) return new Response("Not found", { status: 404 });
  if (!(await allow(getPool(), [[`inbound:${await clientIp()}`, 60, 300]]))) return new Response("Slow down", { status: 429 });
  let payload: unknown;
  try { payload = await req.json(); } catch { return Response.json({ ok: false }, { status: 400 }); }
  try {
    const r = await handleInbound(getPool(), parseInbound(payload));
    return Response.json(r.ok ? { ok: true } : { ok: false, reason: r.reason });
  } catch { return Response.json({ ok: false }, { status: 500 }); }
}
