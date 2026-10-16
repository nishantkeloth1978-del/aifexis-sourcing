import { after } from "next/server";
import { autoDraftRequest } from "@/agents/autodraft";
import { getPool } from "@/lib/db";
import { postRequest } from "@/integrations/api";
import { fail, guard, json } from "@/integrations/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_BYTES = 64 * 1024;

export async function POST(req: Request) {
  const g = await guard(req); if ("response" in g) return g.response;
  const text = await req.text();
  if (text.length > MAX_BYTES) return fail(413, "too_large", "The body is too large (64 KB at most).");
  let body: unknown;
  try { body = JSON.parse(text); } catch { return fail(400, "invalid_json", "The body is not valid JSON."); }
  const out = await postRequest(getPool(), g.client, req.headers.get("idempotency-key"), body);
  // A new request that did not become an event on arrival gets its AI first draft (when the company switched that on) after the answer is sent.
  const b = out.body as { id?: string; eventReference?: string | null; duplicate?: boolean };
  if (out.status === 201 && b.id && !b.eventReference && !b.duplicate) { const id = b.id, tenant = g.client.tenantId; after(() => autoDraftRequest(getPool(), tenant, id).catch((e) => console.error("auto draft failed", e instanceof Error ? e.message : e))); }
  return json(out);
}
