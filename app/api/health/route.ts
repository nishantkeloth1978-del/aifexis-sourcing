import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbConfigured = Boolean(process.env.DATABASE_URL);
  let db: "ok" | "down" | "not configured" = "not configured";
  if (dbConfigured) { try { await getPool().query("select 1"); db = "ok"; } catch { db = "down"; } }
  return Response.json({ ok: db !== "down", service: "aifexis-sourcing", db, authConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) }, { status: db === "down" ? 503 : 200 });
}
