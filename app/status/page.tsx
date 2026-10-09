import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Status" };

/** A public page that says whether the service and its database respond. No account or tenant data. */
export default async function Status() {
  let db: "ok" | "down" | "not configured" = "not configured";
  const t0 = Date.now();
  if (process.env.DATABASE_URL) { try { await getPool().query("select 1"); db = "ok"; } catch { db = "down"; } }
  const ms = Date.now() - t0;
  const rows: [string, string][] = [["Web application", "Operational"], ["Database", db === "ok" ? `Operational (${ms} ms)` : db === "down" ? "Unavailable" : "Not configured"], ["Sign-in", process.env.NEXT_PUBLIC_SUPABASE_URL ? "Configured" : "Not configured"]];
  return (
    <main style={{ maxWidth: 560, margin: "48px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif" }}>
      <h1>Aifexis Sourcing status</h1>
      <p>{db === "down" ? "Some services are unavailable." : "All systems operational."}</p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}><tbody>{rows.map(([a, b]) => <tr key={a}><td style={{ padding: "8px 0", borderBottom: "1px solid #ddd" }}>{a}</td><td style={{ textAlign: "right", borderBottom: "1px solid #ddd" }}>{b}</td></tr>)}</tbody></table>
      <p style={{ color: "#666", fontSize: 13 }}>Checked {new Date().toISOString()}.</p>
    </main>
  );
}
