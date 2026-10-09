"use client";
import { useState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { SubmissionCheck as Check } from "@/bids/service";
import { checkSubmissionAction } from "../../app/supplier/events/[id]/actions";

/** Lets a bidder check, after a lost connection or a doubt, exactly what the buyer's system holds for them. */
export default function SubmissionCheck({ locale, eventId, currency }: { locale: Locale; eventId: string; currency: string }) {
  const [code, setCode] = useState("");
  const [res, setRes] = useState<Check | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    const r = await checkSubmissionAction(eventId, code).catch(() => ({ ok: false as const, error: "That could not be checked. Try again." }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); setRes(null); return; }
    setRes(r.check);
  }
  return (
    <details className="card detail">
      <summary><b>{tx(locale, "Check my submission")}</b></summary>
      <p className="sub">{tx(locale, "Lost your connection or unsure it went through? See what is held for you, and compare it with the code on your receipt.")}</p>
      <form className="additem" onSubmit={run}>
        <label>{tx(locale, "Receipt code (optional)")} <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} /></label>
        <button className="btn" type="submit" disabled={busy}>{tx(locale, "Check")}</button>
      </form>
      {err && <div className="alert" role="alert">{tx(locale, err)}</div>}
      {res && <div role="status">
        {!res.held ? <div className="alert">{tx(locale, "Nothing has been submitted for you yet. Your draft in the form is not saved until you submit.")}</div> : <>
          <div className="okbox">{tx(locale, "Revision {n} is held, submitted {d}. {lines} priced lines, total {t}.", { n: res.revisionNo, d: res.submittedAt ? new Date(res.submittedAt).toLocaleString(locale === "ar" ? "ar-AE" : "en-GB") : "-", lines: res.lines, t: `${currency} ${res.total ?? "-"}` })}</div>
          <div className="sub">{tx(locale, "Receipt code")}: <b>{res.fingerprint}</b></div>
          {res.matches === true && <div className="okbox">{tx(locale, "The code you entered matches what is held.")}</div>}
          {res.matches === false && <div className="alert">{tx(locale, "The code you entered does not match what is held. Your last submission may differ from the one on your receipt.")}</div>}
        </>}
      </div>}
    </details>
  );
}
