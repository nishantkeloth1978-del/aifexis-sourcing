"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { respondAction } from "../../app/supplier/events/[id]/actions";

/** The supplier's answer to the invitation. Accepting is a confirmation; declining stops bidding and tells the buyer why. */
export default function ParticipationPanel({ eventId, current, canChange, hasBid, locale = "en" }: { eventId: string; current: "accepted" | "declined" | null; canChange: boolean; hasBid: boolean; locale?: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  async function send(response: "accepted" | "declined") {
    setError(null); setBusy(true);
    const r = await respondAction(eventId, response, reason).catch(() => ({ ok: false, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "That could not be saved. Try again."); return; }
    setDeclining(false); router.refresh();
  }
  if (!canChange) return null;
  return (
    <div className="bidcard">
      <b>{current === "declined" ? tx(locale, "You declined this invitation") : current === "accepted" ? tx(locale, "You confirmed that you will take part") : tx(locale, "Will you take part?")}</b>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      {declining ? (
        <div>
          <label>{tx(locale, "Reason for declining")}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="actions"><button className="btn" type="button" disabled={busy} onClick={() => send("declined")}>{tx(locale, "Send")}</button><button className="btn ghost" type="button" onClick={() => setDeclining(false)}>{tx(locale, "Cancel")}</button></div>
        </div>
      ) : (
        <div className="actions">
          {current !== "accepted" && <button className="btn" type="button" disabled={busy} onClick={() => send("accepted")}>{tx(locale, "Accept and take part")}</button>}
          {current !== "declined" && !hasBid && <button className="btn ghost" type="button" disabled={busy} onClick={() => setDeclining(true)}>{tx(locale, "Decline")}</button>}
          {current === "declined" && <button className="btn" type="button" disabled={busy} onClick={() => send("accepted")}>{tx(locale, "Change my mind and take part")}</button>}
        </div>
      )}
    </div>
  );
}
