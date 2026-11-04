"use server";
import { getPool } from "@/lib/db";
import { clientIp } from "@/lib/guard";
import { allow, TOO_MANY } from "@/lib/ratelimit";
import { submitApplication } from "@/suppliers/registration";

export interface RegState { error?: string; done?: boolean }
export async function registerVendorAction(key: string, _prev: RegState, form: FormData): Promise<RegState> {
  if (!(await allow(getPool(), [[`vendorreg:ip:${await clientIp()}`, 3600, 10], [`vendorreg:key:${key.slice(0, 12)}`, 3600, 60]], { failClosed: true }))) return { error: TOO_MANY };
  const f = (n: string) => String(form.get(n) ?? "").slice(0, 1000);
  if (f("website")) return { done: true };   // a hidden field only bots fill in
  try {
    const r = await submitApplication(getPool(), key, { company: f("company"), contactName: f("contactName"), contactEmail: f("contactEmail"), country: f("country"), category: f("category"), phone: f("phone"), taxNo: f("taxNo"), notes: f("notes") });
    return r.ok ? { done: true } : { error: r.error };
  } catch { return { error: "That could not be sent. Try again." }; }
}
