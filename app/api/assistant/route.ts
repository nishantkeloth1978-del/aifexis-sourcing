import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { chat } from "@/assistant/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The assistant for signed-in staff. Same-origin only (the browser sends the session cookie); the body is small and strictly checked in chat(). */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return new Response("Not found", { status: 404 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return new Response("Not found", { status: 404 });
  const text = await req.text();
  if (text.length > 60_000) return Response.json({ ok: false, error: "Ask a question of up to 2000 characters." }, { status: 413 });
  let body: { messages?: unknown; path?: unknown };
  try { body = JSON.parse(text); } catch { return Response.json({ ok: false, error: "Ask a question of up to 2000 characters." }, { status: 400 }); }
  const out = await chat(getPool(), s, { messages: body.messages, path: typeof body.path === "string" ? body.path : "" });
  return Response.json(out, { headers: { "Cache-Control": "no-store" } });
}
