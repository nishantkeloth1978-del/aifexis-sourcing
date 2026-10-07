"use client";
import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <form action={action} className="loginform">
      <label>Email<input name="email" type="email" autoComplete="username" required autoFocus /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      {state.error && <div className="alert" role="alert">{state.error}</div>}
      <button className="btn" type="submit" disabled={pending}>{pending ? "Signing in..." : "Sign in"}</button>
    </form>
  );
}
