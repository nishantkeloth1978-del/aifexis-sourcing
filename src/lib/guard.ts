import { headers } from "next/headers";
import { getPool } from "./db";
import { allow } from "./ratelimit";

/** Best-effort client address behind Vercel's proxy. Used only as a rate-limit key, never for access decisions. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim().slice(0, 64);
}

/** Per-person ceiling for ordinary actions: 120 a minute is far above normal use and far below a script. */
export const withinRate = (who: string, kind = "act", max = 120) => allow(getPool(), [[`${kind}:${who}`, 60, max]]);
