/**
 * Sign-in assurance. When REQUIRE_MFA=true, staff must have confirmed a second factor (Supabase level "aal2").
 * The middleware sends people to the right page; THIS check is the one every server action and download route relies on,
 * so a direct call with a password-only session is refused whatever route it arrives by.
 */
export const mfaRequired = (env: Record<string, string | undefined> = process.env) => env.REQUIRE_MFA === "true";
export const aalOk = (aal: unknown, env: Record<string, string | undefined> = process.env) => !mfaRequired(env) || aal === "aal2";

export const STEP_UP_SECONDS = 600;
interface Amr { method?: unknown; timestamp?: unknown }

/** True when a second factor was confirmed within the last maxAge seconds (claims.amr lists each sign-in method with its time). */
export function recentSecondFactor(amr: unknown, nowMs: number = Date.now(), maxAgeSec: number = STEP_UP_SECONDS): boolean {
  if (!Array.isArray(amr)) return false;
  return (amr as Amr[]).some((a) => (a?.method === "totp" || a?.method === "mfa/totp" || a?.method === "phone") && typeof a.timestamp === "number" && nowMs / 1000 - a.timestamp <= maxAgeSec && a.timestamp <= nowMs / 1000 + 60);
}

/** Where to send someone after confirming: only a path on this site. */
export function safeNext(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  return /^\/[A-Za-z0-9/_\-?=&%.]*$/.test(s) && !s.startsWith("//") ? s : "/";
}

/** Is a fresh second factor needed for a sensitive action? Only when MFA is required at all. */
export const needsStepUp = (amr: unknown, env: Record<string, string | undefined> = process.env, nowMs: number = Date.now()) => mfaRequired(env) && !recentSecondFactor(amr, nowMs);
