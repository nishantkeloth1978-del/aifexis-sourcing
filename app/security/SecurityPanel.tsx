"use client";
import { useActionState, useState, useTransition } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { confirmEnrol, removeFactor, startEnrol, type CodeState, type EnrolState } from "./actions";

export default function SecurityPanel({ locale = "en", enrolled, factorId: existing, required, done }: { locale?: Locale; enrolled: boolean; factorId: string | null; required: boolean; done: boolean }) {
  const [enrol, setEnrol] = useState<EnrolState | null>(null);
  const [pending, start] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [state, action, busy] = useActionState<CodeState, FormData>(confirmEnrol.bind(null, enrol?.factorId ?? ""), {});
  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, "Two-step sign-in")}</h3><span className="pill">{enrolled ? tx(locale, "On") : tx(locale, "Off")}</span></div>
      <div className="sub">{tx(locale, "Use an authenticator app (for example Microsoft Authenticator or Google Authenticator) to confirm your sign-in with a 6-digit code.")}</div>
      {required && !enrolled && <div className="alert" role="alert">{tx(locale, "Your organisation requires two-step sign-in. Set it up to continue.")}</div>}
      {done && <div className="okbox">{tx(locale, "Two-step sign-in is on.")}</div>}
      {enrolled ? (
        <div className="actions">
          {existing && <button className="btn secondary" type="button" disabled={pending} onClick={() => start(async () => { const r = await removeFactor(existing); if (r?.error) setRemoveError(r.error); })}>{tx(locale, "Turn off")}</button>}
          {removeError && <div className="alert" role="alert">{tx(locale, removeError)}</div>}
        </div>
      ) : !enrol?.factorId ? (
        <div className="actions">
          <button className="btn" type="button" disabled={pending} onClick={() => start(async () => setEnrol(await startEnrol()))}>{tx(locale, "Set up")}</button>
          {enrol?.error && <div className="alert" role="alert">{tx(locale, enrol.error)}</div>}
        </div>
      ) : (
        <form action={action} className="loginform">
          <p>{tx(locale, "1. Scan this code with your authenticator app.")}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrol.qr} alt={tx(locale, "QR code for your authenticator app")} width={200} height={200} />
          <p className="sub">{tx(locale, "Cannot scan? Enter this key instead:")} <code dir="ltr">{enrol.secret}</code></p>
          <label>{tx(locale, "2. Enter the 6-digit code")}<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required dir="ltr" /></label>
          {state.error && <div className="alert" role="alert">{tx(locale, state.error)}</div>}
          <button className="btn" type="submit" disabled={busy}>{tx(locale, "Turn on")}</button>
        </form>
      )}
    </div>
  );
}
