export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, service: "aifexis-sourcing", dbConfigured: Boolean(process.env.DATABASE_URL), authConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) });
}
