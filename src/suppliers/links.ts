/** The address suppliers open. APP_URL (or NEXT_PUBLIC_SUPPLIER_URL / SUPPLIER_APP_URL) should be your public site, for example https://sourcing.aifexis.com. */
export function appBase(env: Record<string, string | undefined> = process.env): string {
  const b = env.NEXT_PUBLIC_SUPPLIER_URL || env.SUPPLIER_APP_URL || env.APP_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return b.replace(/\/$/, "");
}
export const inviteLink = (token: string) => { const b = appBase(); return b ? `${b}/invite/${token}` : ""; };
