"use client";
import { useActionState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { registerVendorAction, type RegState } from "./actions";

export default function RegisterForm({ regKey, locale = "en" }: { regKey: string; locale?: Locale }) {
  const [st, action, pending] = useActionState<RegState, FormData>(registerVendorAction.bind(null, regKey), {});
  if (st.done) return <div className="linkbox" role="status">{tx(locale, "Thank you. Your application was received. You will get an e-mail once it has been reviewed.")}</div>;
  return (
    <form action={action} className="loginform">
      <label>{tx(locale, "Company name")}<input name="company" required minLength={2} maxLength={200} /></label>
      <label>{tx(locale, "Contact person")}<input name="contactName" required minLength={2} maxLength={100} /></label>
      <label>{tx(locale, "Contact email")}<input name="contactEmail" type="email" required maxLength={200} autoComplete="email" /></label>
      <label>{tx(locale, "Phone")}<input name="phone" maxLength={50} autoComplete="tel" /></label>
      <label>{tx(locale, "Country")}<input name="country" maxLength={100} /></label>
      <label>{tx(locale, "What do you supply? (category)")}<input name="category" maxLength={100} /></label>
      <label>{tx(locale, "Tax or trade licence number")}<input name="taxNo" maxLength={100} /></label>
      <label>{tx(locale, "Anything else we should know")}<textarea name="notes" rows={3} maxLength={1000} /></label>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px", height: 0, width: 0, opacity: 0 }} />
      {st.error && <div className="alert" role="alert">{tx(locale, st.error)}</div>}
      <button className="btn" type="submit" disabled={pending}>{pending ? tx(locale, "Please wait...") : tx(locale, "Send application")}</button>
    </form>
  );
}
