/**
 * How the server checks the database's certificate.
 *   DATABASE_SSL_CA=<PEM text>   verify the certificate and host name against this authority (recommended; Supabase publishes its CA in the dashboard)
 *   DATABASE_SSL_VERIFY=system   verify against the operating system's public authorities
 *   neither                      encrypted but NOT verified (the previous behaviour); /api/health reports it so it is visible
 * Local databases use no TLS.
 */
export type SslMode = "none" | "ca" | "system" | "unverified";
export interface SslChoice { mode: SslMode; options: false | { ca?: string; rejectUnauthorized: boolean } | undefined }

export function sslFor(connectionString: string, env: Record<string, string | undefined> = process.env): SslChoice {
  if (/localhost|127\.0\.0\.1|\/\/\[?::1\]?/.test(connectionString)) return { mode: "none", options: undefined };
  const ca = env.DATABASE_SSL_CA?.trim();
  if (ca) return { mode: "ca", options: { ca: ca.replace(/\\n/g, "\n"), rejectUnauthorized: true } };
  if (env.DATABASE_SSL_VERIFY === "system") return { mode: "system", options: { rejectUnauthorized: true } };
  return { mode: "unverified", options: { rejectUnauthorized: false } };
}
