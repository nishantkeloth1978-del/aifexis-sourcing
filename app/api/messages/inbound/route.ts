import { timingSafeEqual } from "node:crypto";
import { getPool } from "@/lib/db";
import { clientIp } from "@/lib/guard";
import { allow } from "@/lib/ratelimit";
import { handleInbound, parseInbound } from "@/messages/inbound";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Mail providers that cannot set a custom header can use HTTP basic authentication: the password is the secret. Never the URL, which ends up in logs. */
function basicPassword(h: string | null): string | null {
  if (!h?.toLowerCase().startsWith("basic ")) return null;
  const decoded = Buffer.from(h.slice(6), "base64").toString("utf8");
  const i = decoded.indexOf(":");
  return i < 0 ? null : decoded.slice(i + 1);
}
const MAX_INBOUND_BYTES = 25 * 1024 * 1024;

function authorised(req: Request): boolean {
  const secret = process.env.MESSAGES_INBOUND_SECRET;
  if (!secret) return false;
  const given = req.headers.get("x-inbound-secret") ?? basicPassword(req.headers.get("authorization")) ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The mail provider posts each reply here. Always answers 200 for a well-formed call so the provider does not retry a reply we refused on purpose. */
export async function POST(req: Request) {
  if (!authorised(req)) return new Response("Not found", { status: 404 });
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_INBOUND_BYTES) return new Response("Too large", { status: 413 });
  if (!(await allow(getPool(), [[`inbound:${await clientIp()}`, 60, 300]]))) return new Response("Slow down", { status: 429 });
  let payload: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_INBOUND_BYTES) return new Response("Too large", { status: 413 });
    payload = JSON.parse(text);
  } catch { return Response.json({ ok: false }, { status: 400 }); }
  try {
    const r = await handleInbound(getPool(), parseInbound(payload));
    return Response.json(r.ok ? { ok: true } : { ok: false, reason: r.reason });
  } catch { return Response.json({ ok: false }, { status: 500 }); }
}
