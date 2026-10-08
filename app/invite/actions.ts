"use server";
import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { supabaseServer } from "@/lib/supabase/server";
import { clientIp } from "@/lib/guard";
import { allow, TOO_MANY } from "@/lib/ratelimit";
import { acceptInvitation, invitationInfo } from "@/suppliers/service";

export interface InviteState { error?: string; notice?: string }
const BAD_LINK = "This invitation link is not valid or has expired. Ask the buyer for a new one.";

async function finish(token: string, authUserId: string, email: string): Promise<InviteState> {
  const ok = await acceptInvitation(getPool(), token, authUserId, email).catch(() => false);
  if (!ok) return { error: "This sign-in does not match the invited email address, or the link has expired." };
  redirect("/supplier");
}

export async function inviteSignUp(token: string, _prev: InviteState, form: FormData): Promise<InviteState> {
  if (!(await allow(getPool(), [[`invite:ip:${await clientIp()}`, 600, 30], [`invite:token:${token.slice(0, 24)}`, 600, 20]]))) return { error: TOO_MANY };
  const info = await invitationInfo(getPool(), token);
  if (!info || info.expired) return { error: BAD_LINK };
  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { error: "Choose a password of at least 8 characters." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({ email: info.contactEmail, password });
  if (error) return { error: /registered|exists/i.test(error.message) ? "This email already has an account. Use \"I already have a password\"." : "Could not create the account. Try again." };
  if (!data.session || !data.user) return { notice: "Account created. Check your email to confirm it, then open this link again and sign in." };
  return finish(token, data.user.id, info.contactEmail);
}

export async function inviteSignIn(token: string, _prev: InviteState, form: FormData): Promise<InviteState> {
  if (!(await allow(getPool(), [[`invite:ip:${await clientIp()}`, 600, 30], [`invite:token:${token.slice(0, 24)}`, 600, 20]]))) return { error: TOO_MANY };
  const info = await invitationInfo(getPool(), token);
  if (!info || info.expired) return { error: BAD_LINK };
  const password = String(form.get("password") ?? "");
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email: info.contactEmail, password });
  if (error || !data.user) return { error: "Email or password is not correct." };
  return finish(token, data.user.id, info.contactEmail);
}
