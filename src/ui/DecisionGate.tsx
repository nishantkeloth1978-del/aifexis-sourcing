"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { DecisionRow } from "@/decisions/service";
import type { TransitionPayload } from "@/authz";
import { requestDecisionAction, withdrawDecisionAction } from "../../app/decisions/actions";

/**
 * The second-person step. The named witness or approver must confirm for themselves; only then can the requester run the step.
 * `secondId` is the person chosen on screen; a request made for someone else, or for an older state of the event, does not count.
 */
export default function DecisionGate({ locale, eventId, version, command, secondId, secondEmail, payload, request, ready, runLabel, busyLabel, disabled, onRun }: {
  locale: Locale; eventId: string; version: number; command: string; secondId: string; secondEmail: string; payload: TransitionPayload;
  request: DecisionRow | null; ready?: boolean; runLabel: string; busyLabel: string; disabled?: boolean;
  onRun: () => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mine = request && request.designatedId === secondId && !request.stale ? request : null;
  async function go(f: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true); setErr(null);
    const r = await f().catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    router.refresh();
  }
  return (
    <div className="stack">
      {mine?.status === "pending" && (
        <div className="sub">{tx(locale, "Waiting for {0} to confirm. They will see it under Confirmations.", { "0": mine.designatedEmail })}
          {" "}<button className="btn ghost" type="button" disabled={busy} onClick={() => go(() => withdrawDecisionAction(mine.id))}>{tx(locale, "Withdraw the request")}</button></div>
      )}
      {mine?.status === "rejected" && <div className="alert" role="alert">{tx(locale, "{0} declined this request.", { "0": mine.designatedEmail })}</div>}
      {mine?.status === "expired" && <div className="sub">{tx(locale, "The request expired. Ask again.")}</div>}
      {mine?.status === "confirmed" && <div className="sub">{tx(locale, "{0} confirmed. You can go ahead.", { "0": mine.designatedEmail })}</div>}
      {err && <div className="alert" role="alert">{tx(locale, err)}</div>}
      <div className="actions">
        {mine?.status === "confirmed"
          ? <button className="btn" type="button" disabled={busy || disabled} onClick={() => go(onRun)}>{busy ? busyLabel : runLabel}</button>
          : mine?.status === "pending" ? null
          : <button className="btn" type="button" disabled={busy || disabled || !secondId || ready === false} onClick={() => go(() => requestDecisionAction(eventId, version, command, payload))}>{busy ? tx(locale, "Sending...") : tx(locale, "Ask {0} to confirm", { "0": secondEmail || tx(locale, "the other person") })}</button>}
      </div>
    </div>
  );
}
