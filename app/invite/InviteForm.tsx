"use client";
import { useActionState, useState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { inviteSignIn, inviteSignUp, type InviteState } from "./actions";

export default function InviteForm({ token, email, locale = "en" }: { token: string; email: string; locale?: Locale }) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [up, upAction, upPending] = useActionState<InviteState, FormData>(inviteSignUp.bind(null, token), {});
  const [inn, inAction, inPending] = useActionState<InviteState, FormData>(inviteSignIn.bind(null, token), {});
  const state = mode === "new" ? up : inn;
  return (
    <form action={mode === "new" ? upAction : inAction} className="loginform">
      <label>{tx(locale, "Email")}<input value={email} readOnly /></label>
      <label>{mode === "new" ? tx(locale, "Choose a password (8+ characters)") : tx(locale, "Password")}
        <input name="password" type="password" autoComplete={mode === "new" ? "new-password" : "current-password"} required minLength={mode === "new" ? 8 : 1} /></label>
      {state.error && <div className="alert" role="alert">{tx(locale, state.error)}</div>}
      {state.notice && <div className="linkbox" role="status">{tx(locale, state.notice)}</div>}
      <button className="btn" type="submit" disabled={upPending || inPending}>{upPending || inPending ? tx(locale, "Please wait...") : mode === "new" ? tx(locale, "Create account and continue") : tx(locale, "Sign in and continue")}</button>
      <button className="signout" style={{ color: "var(--blue-600)" }} type="button" onClick={() => setMode(mode === "new" ? "existing" : "new")}>
        {mode === "new" ? tx(locale, "I already have a password") : tx(locale, "Create a new account instead")}
      </button>
    </form>
  );
}
