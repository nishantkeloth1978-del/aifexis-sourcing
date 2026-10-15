import { getPool } from "@/lib/db";
import { postRequest } from "@/integrations/api";
import { fail, guard, json } from "@/integrations/route";

export const dynamic = "force-dynamic";
const MAX_BYTES = 64 * 1024;

export async function POST(req: Request) {
  const g = await guard(req); if ("response" in g) return g.response;
  const text = await req.text();
  if (text.length > MAX_BYTES) return fail(413, "too_large", "The body is too large (64 KB at most).");
  let body: unknown;
  try { body = JSON.parse(text); } catch { return fail(400, "invalid_json", "The body is not valid JSON."); }
  return json(await postRequest(getPool(), g.client, req.headers.get("idempotency-key"), body));
}
