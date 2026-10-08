"use client";
import { useActionState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { challenge, type CodeState } from "../security/actions";

export default function ChallengeForm({ locale = "en" }: { locale?: Locale }) {
  const [state, action, pending] = useActionState<CodeState, FormData>(challenge, {});
  return (
    <form action={action} className="loginform">
      <label>{tx(locale, "6-digit code")}<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus dir="ltr" /></label>
      {state.error && <div className="alert" role="alert">{tx(locale, state.error)}</div>}
      <button className="btn" type="submit" disabled={pending}>{tx(locale, "Confirm")}</button>
    </form>
  );
}
