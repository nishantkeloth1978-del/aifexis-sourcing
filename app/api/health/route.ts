import { mailConfigured } from "@/automation/mailer";
import { dbTlsMode, getPool } from "@/lib/db";
import { missingMigrations } from "@/lib/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbConfigured = Boolean(process.env.DATABASE_URL);
  let db: "ok" | "down" | "not configured" = "not configured";
  if (dbConfigured) { try { await getPool().query("select 1"); db = "ok"; } catch { db = "down"; } }
  let behind: string[] = [];
  if (db === "ok") { try { behind = await missingMigrations(getPool()); } catch { behind = []; } }
  return Response.json({ ok: db !== "down", schema: db !== "ok" ? "unknown" : behind.length ? "behind" : "current", ...(behind.length ? { missingMigrations: behind } : {}), service: "aifexis-sourcing", db, dbTls: dbTlsMode(), mail: mailConfigured() ? "configured" : "not configured (messages are logged, not sent)", authConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) }, { status: db === "down" ? 503 : 200 });
}
