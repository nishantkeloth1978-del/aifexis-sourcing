export const dynamic = "force-dynamic";

/** The server's clock, so the closing countdown does not depend on the visitor's own clock. */
export async function GET() {
  return Response.json({ now: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
