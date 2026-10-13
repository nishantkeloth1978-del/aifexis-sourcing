/**
 * Which pages a deployment serves. The same code can run as two separate sites:
 *   PORTAL=supplier  the supplier site: only supplier pages, invitation links and the files and time routes they use
 *   PORTAL=buyer     the buyer site: everything except the supplier pages
 *   unset            one site serving both (the default; nothing changes)
 * A page that does not belong on a site answers 404, as if it did not exist.
 */
export type Portal = "supplier" | "buyer" | "both";
export const portalOf = (env: Record<string, string | undefined> = process.env): Portal => (env.PORTAL === "supplier" ? "supplier" : env.PORTAL === "buyer" ? "buyer" : "both");

const SUPPLIER_SITE = ["/supplier", "/login", "/invite", "/no-access", "/lang", "/status", "/api/health", "/api/time", "/api/supplier", "/api/files", "/api/messages"];
const SUPPLIER_ONLY = ["/supplier", "/invite", "/api/supplier"];
const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");

export type Gate = { kind: "allow" } | { kind: "notfound" } | { kind: "redirect"; to: string };
export function gate(path: string, portal: Portal): Gate {
  if (portal === "supplier") {
    if (path === "/") return { kind: "redirect", to: "/supplier" };
    return SUPPLIER_SITE.some((p) => under(path, p)) ? { kind: "allow" } : { kind: "notfound" };
  }
  if (portal === "buyer") return SUPPLIER_ONLY.some((p) => under(path, p)) ? { kind: "notfound" } : { kind: "allow" };
  return { kind: "allow" };
}
/** Where a signed-in person with no supplier account goes. On the supplier site staff must not bounce back to the home page, which would loop. */
export const staffLanding = (portal: Portal = portalOf()) => (portal === "supplier" ? "/no-access" : "/");
