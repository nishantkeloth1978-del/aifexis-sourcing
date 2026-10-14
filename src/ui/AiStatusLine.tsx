"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { dateLocale } from "@/i18n/dict";
import { describeAi, type AiStatus } from "@/lib/aistatus-text";
import { testAiAction } from "../../app/configuration/actions";

export default function AiStatusLine({ status, locale = "en" }: { status: AiStatus; locale?: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const d = describeAi(status);
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(dateLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "");
  async function test() {
    setBusy(true); setMsg(null);
    const r = await testAiAction().catch(() => ({ ok: false, error: "That could not be saved. Try again." }));
    setBusy(false); setMsg(r.ok ? tx(locale, "The AI service answered.") : tx(locale, r.error ?? "That is not allowed."));
    router.refresh();
  }
  const label: Record<typeof d.level, string> = { off: "Not set up", ok: "Working", idle: "Key set", bad: "Needs attention" };
  return (
    <div className="aistatus" role="status" data-level={d.level}>
      <span><b>{tx(locale, "AI status")}:</b> {tx(locale, label[d.level])}. {tx(locale, d.text)}
        {status.lastOkAt && <span className="sub"> {tx(locale, "Last successful call: {d}.", { d: when(status.lastOkAt) })}</span>}
        {status.lastFailAt && d.level === "bad" && <span className="sub"> {tx(locale, "Last problem: {d}.", { d: when(status.lastFailAt) })}</span>}
      </span>
      {status.keySet && <button className="btn ghost" type="button" disabled={busy} onClick={test}>{busy ? tx(locale, "Testing...") : tx(locale, "Test now")}</button>}
      {msg && <span className="sub" aria-live="polite"> {msg}</span>}
    </div>
  );
}
