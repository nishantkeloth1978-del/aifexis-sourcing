export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, service: "aifexis-sourcing", dbConfigured: Boolean(process.env.DATABASE_URL) });
}
