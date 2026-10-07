"use client";
import { useActionState, useState } from "react";
import { inviteSignIn, inviteSignUp, type InviteState } from "./actions";

export default function InviteForm({ token, email }: { token: string; email: string }) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [up, upAction, upPending] = useActionState<InviteState, FormData>(inviteSignUp.bind(null, token), {});
  const [inn, inAction, inPending] = useActionState<InviteState, FormData>(inviteSignIn.bind(null, token), {});
  const state = mode === "new" ? up : inn;
  return (
    <form action={mode === "new" ? upAction : inAction} className="loginform">
      <label>Email<input value={email} readOnly /></label>
      <label>{mode === "new" ? "Choose a password (8+ characters)" : "Password"}
        <input name="password" type="password" autoComplete={mode === "new" ? "new-password" : "current-password"} required minLength={mode === "new" ? 8 : 1} /></label>
      {state.error && <div className="alert" role="alert">{state.error}</div>}
      {state.notice && <div className="linkbox" role="status">{state.notice}</div>}
      <button className="btn" type="submit" disabled={upPending || inPending}>{upPending || inPending ? "Please wait..." : mode === "new" ? "Create account and continue" : "Sign in and continue"}</button>
      <button className="signout" style={{ color: "var(--blue-600)" }} type="button" onClick={() => setMode(mode === "new" ? "existing" : "new")}>
        {mode === "new" ? "I already have a password" : "Create a new account instead"}
      </button>
    </form>
  );
}
