"use client";
import { useActionState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { signIn, type LoginState } from "./actions";

export default function LoginForm({ locale = "en" }: { locale?: Locale }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <form action={action} className="loginform">
      <label>{tx(locale, "Email")}<input name="email" type="email" autoComplete="username" required autoFocus /></label>
      <label>{tx(locale, "Password")}<input name="password" type="password" autoComplete="current-password" required /></label>
      {state.error && <div className="alert" role="alert">{tx(locale, state.error)}</div>}
      <button className="btn" type="submit" disabled={pending}>{pending ? tx(locale, "Signing in...") : tx(locale, "Sign in")}</button>
    </form>
  );
}
