import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { resolveAction } from "@/assistant/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The person's decision on a change the assistant prepared. Same-origin only; runs as the signed-in person, once. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return new Response("Not found", { status: 404 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return new Response("Not found", { status: 404 });
  const text = await req.text();
  let body: { id?: unknown; decision?: unknown };
  try { body = text.length < 1000 ? JSON.parse(text) : {}; } catch { body = {}; }
  if (typeof body.id !== "string" || (body.decision !== "confirm" && body.decision !== "cancel")) return Response.json({ ok: false, error: "This request has expired or was already handled." }, { status: 400 });
  let out;
  try { out = await resolveAction(getPool(), s, body.id, body.decision); } catch { out = { ok: false as const, error: "That change could not be made. Nothing was changed." }; }
  return Response.json(out, { headers: { "Cache-Control": "no-store" } });
}
