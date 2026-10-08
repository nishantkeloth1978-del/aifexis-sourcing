"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getPool } from "@/lib/db";
import { clientIp } from "@/lib/guard";
import { allow, TOO_MANY } from "@/lib/ratelimit";

export interface EnrolState { error?: string; factorId?: string; qr?: string; secret?: string }
export interface CodeState { error?: string }

/** Starts authenticator-app enrolment. Any half-finished enrolment is cleared first. */
export async function startEnrol(): Promise<EnrolState> {
  const supabase = await supabaseServer();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { error: "Your session has ended. Sign in again." };
  const { data: f } = await supabase.auth.mfa.listFactors();
  for (const x of f?.all ?? []) if (x.factor_type === "totp" && x.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: x.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) return { error: "Two-step sign-in could not be started. Try again." };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

async function verify(factorId: string, code: string): Promise<string | null> {
  if (!/^\d{6}$/.test(code)) return "Enter the 6-digit code from your authenticator app.";
  if (!(await allow(getPool(), [[`mfa:ip:${await clientIp()}`, 600, 20]]))) return TOO_MANY;
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  return error ? "That code is not correct. Try again." : null;
}

export async function confirmEnrol(factorId: string, _prev: CodeState, form: FormData): Promise<CodeState> {
  const err = await verify(factorId, String(form.get("code") ?? "").trim());
  if (err) return { error: err };
  redirect("/security?done=1");
}

/** The sign-in challenge for someone who already has an authenticator app. */
export async function challenge(_prev: CodeState, form: FormData): Promise<CodeState> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp?.[0];
  if (!factor) redirect("/security");
  const err = await verify(factor.id, String(form.get("code") ?? "").trim());
  if (err) return { error: err };
  redirect("/");
}

export async function removeFactor(factorId: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { error: "Confirm your authenticator code first, then try again." };
  redirect("/security");
}
