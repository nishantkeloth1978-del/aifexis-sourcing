import { redirect } from "next/navigation";
import { getStepUpSession, type Session } from "./session";

/**
 * For sensitive server actions. Returns the session when a second factor was confirmed in the last 10 minutes,
 * sends the person to confirm (and back to where they were) when it was not, and null when nobody is signed in.
 */
export async function stepUpSession(backTo: string): Promise<Session | null> {
  const r = await getStepUpSession();
  if (r.ok) return r.session;
  if (r.reason === "STEP_UP") redirect(`/mfa?next=${encodeURIComponent(backTo)}`);
  return null;
}
