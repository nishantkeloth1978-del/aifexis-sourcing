import { getPool } from "@/lib/db";
import { getRequestApi } from "@/integrations/api";
import { guard, json } from "@/integrations/route";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const g = await guard(req); if ("response" in g) return g.response;
  return json(await getRequestApi(getPool(), g.client, decodeURIComponent((await ctx.params).ref)));
}
