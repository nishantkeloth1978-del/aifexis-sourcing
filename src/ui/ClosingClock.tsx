"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import { dateLocale, type Locale } from "@/i18n/dict";
import { offsetFrom, pad2, remaining, SYNC_EVERY_MS } from "@/lib/clock";

/** Countdown to the closing time using the server's clock, with the closing time in the buyer's zone and in the visitor's own zone. */
export default function ClosingClock({ closesAt, timeZone, locale = "en" }: { closesAt: string; timeZone: string; locale?: Locale }) {
  const router = useRouter();
  const [offset, setOffset] = useState(0);
  const [synced, setSynced] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const refreshed = useRef(false);

  useEffect(() => {
    let live = true;
    async function sync() {
      const sent = Date.now();
      try {
        const r = await fetch("/api/time", { cache: "no-store" });
        const j = (await r.json()) as { now: string };
        if (live) { setOffset(offsetFrom(j.now, sent, Date.now())); setSynced(true); }
      } catch { if (live) setSynced(false); }
    }
    void sync();
    const a = setInterval(sync, SYNC_EVERY_MS);
    const b = setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => { live = false; clearInterval(a); clearInterval(b); };
  }, []);

  const left = now === null ? null : remaining(closesAt, now, offset);
  useEffect(() => { if (left?.done && !refreshed.current) { refreshed.current = true; router.refresh(); } }, [left?.done, router]);
  const fmt = (tz?: string) => new Date(closesAt).toLocaleString(dateLocale(locale), { dateStyle: "medium", timeStyle: "short", ...(tz ? { timeZone: tz } : {}), timeZoneName: "short" });
  const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="clock" role="timer" aria-live="off">
      <div style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
        {left === null ? "" : left.done ? tx(locale, "Closed") : `${left.days > 0 ? tx(locale, "{n} d", { n: left.days }) + " " : ""}${pad2(left.h)}:${pad2(left.m)}:${pad2(left.s)}`}
      </div>
      <div className="sub">{tx(locale, "Closes {when}", { when: fmt(timeZone || "UTC") })}{mine && mine !== (timeZone || "UTC") ? ` · ${tx(locale, "your time {when}", { when: fmt() })}` : ""}</div>
      <div className="sub">{synced ? tx(locale, "Clock synchronised with the server.") : tx(locale, "Using your device clock; the server decides when bidding closes.")}</div>
    </div>
  );
}
