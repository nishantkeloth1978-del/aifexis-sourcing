"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { dateLocale } from "@/i18n/dict";
import { describeScan, type ScanStatus } from "@/lib/scanstatus-text";
import { testScannerAction } from "../../app/configuration/actions";

export default function ScannerStatusLine({ status, locale = "en" }: { status: ScanStatus; locale?: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const d = describeScan(status);
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(dateLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "");
  async function test() {
    setBusy(true); setMsg(null);
    const r = await testScannerAction().catch(() => ({ ok: false, error: "That could not be saved. Try again." }));
    setBusy(false); setMsg(r.ok ? tx(locale, "The scanner flagged the test virus and passed the harmless file.") : tx(locale, r.error ?? "That is not allowed."));
    router.refresh();
  }
  const label: Record<typeof d.level, string> = { builtin: "Built-in only", ok: "Working", idle: "Set up", bad: "Needs attention" };
  return (
    <div className="aistatus" role="status" data-level={d.level === "builtin" ? "idle" : d.level}>
      <span><b>{tx(locale, "Upload scanner")}:</b> {tx(locale, label[d.level])}. {tx(locale, d.text)}
        {status.lastOkAt && <span className="sub"> {tx(locale, "Last successful scan: {d}.", { d: when(status.lastOkAt) })}</span>}
        {status.lastFailAt && d.level === "bad" && <span className="sub"> {tx(locale, "Last problem: {d}.", { d: when(status.lastFailAt) })}</span>}
      </span>
      {status.configured && <button className="btn ghost" type="button" disabled={busy} onClick={test}>{busy ? tx(locale, "Testing...") : tx(locale, "Test now")}</button>}
      {msg && <span className="sub" aria-live="polite"> {msg}</span>}
    </div>
  );
}
