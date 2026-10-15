import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { chat, type ChatOut, type StreamEvent } from "@/assistant/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BAD = "Ask a question of up to 2000 characters.";

/**
 * The assistant for signed-in staff. Same-origin only (the browser sends the session cookie); the body is small and strictly checked in chat().
 * With "stream": true the reply is sent as it is written, one JSON object per line (see StreamEvent); otherwise one JSON answer.
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return new Response("Not found", { status: 404 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return new Response("Not found", { status: 404 });
  const text = await req.text();
  if (text.length > 60_000) return Response.json({ ok: false, error: BAD }, { status: 413 });
  let body: { messages?: unknown; path?: unknown; stream?: unknown };
  try { body = JSON.parse(text); } catch { return Response.json({ ok: false, error: BAD }, { status: 400 }); }
  const input = { messages: body.messages, path: typeof body.path === "string" ? body.path : "" };

  if (body.stream !== true) return Response.json(await chat(getPool(), s, input), { headers: { "Cache-Control": "no-store" } });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => { try { controller.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { /* the browser went away */ } };
      let out: ChatOut;
      try { out = await chat(getPool(), s, input, {}, send); } catch { out = { ok: false, error: "The assistant could not answer right now. Try again in a moment." }; }
      send({ t: "done", out });
      try { controller.close(); } catch { /* already closed */ }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
