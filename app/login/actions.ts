"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getPool } from "@/lib/db";
import { clientIp } from "@/lib/guard";
import { allow, TOO_MANY } from "@/lib/ratelimit";

export interface LoginState { error?: string }

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  if (!(await allow(getPool(), [[`login:ip:${await clientIp()}`, 600, 20], [`login:email:${email.toLowerCase()}`, 600, 8]]))) return { error: TOO_MANY };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Email or password is not correct." };
  redirect("/");
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
