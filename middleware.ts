import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { gate, portalOf } from "@/lib/portal";
import { buildCsp, newNonce } from "@/lib/csp";

const PUBLIC = ["/login", "/invite", "/join", "/api/health", "/api/cron", "/api/messages/inbound", "/status"];

export async function middleware(req: NextRequest) {
  const g = gate(req.nextUrl.pathname, portalOf());
  if (g.kind === "notfound") return new NextResponse("Not found", { status: 404 });
  if (g.kind === "redirect") { const url = req.nextUrl.clone(); url.pathname = g.to; url.search = ""; return NextResponse.redirect(url); }
  // A new nonce for every response; Next.js reads it from the request's policy header and stamps it on its own scripts.
  const nonce = newNonce();
  const csp = buildCsp(nonce, { supabase: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", dev: process.env.NODE_ENV !== "production" });
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("Content-Security-Policy", csp);
  const next = () => { const r = NextResponse.next({ request: { headers: reqHeaders } }); r.headers.set("Content-Security-Policy", csp); return r; };
  let res = next();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        reqHeaders.set("cookie", req.headers.get("cookie") ?? "");
        res = next();
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getClaims(); // refreshes the session cookie when needed
  const signedIn = Boolean(data?.claims?.sub);
  const isPublic = PUBLIC.some((p) => req.nextUrl.pathname === p || req.nextUrl.pathname.startsWith(p + "/"));
  if (!signedIn && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // Two-step sign-in for staff, when REQUIRE_MFA=true. Suppliers (/supplier) and the setup pages themselves are exempt.
  const path = req.nextUrl.pathname;
  const exempt = isPublic || ["/supplier", "/security", "/mfa", "/lang", "/no-access"].some((p) => path === p || path.startsWith(p + "/"));
  if (signedIn && !exempt && process.env.REQUIRE_MFA === "true" && data?.claims?.aal !== "aal2") {
    const { data: lvl } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const url = req.nextUrl.clone();
    url.pathname = lvl?.nextLevel === "aal2" ? "/mfa" : "/security";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (signedIn && req.nextUrl.pathname === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
