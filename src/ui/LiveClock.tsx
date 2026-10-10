"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import { dateLocale, type Locale } from "@/i18n/dict";
import { pad2, remaining, shortLeft, urgency } from "@/lib/clock";
import { useServerNow } from "./useServerNow";

/**
 * Live "time left" for an open event. `badge` is the large version for an event page, `mini` fits a list row.
 * It counts down against the server's clock; the server alone decides when bidding closes.
 */
export default function LiveClock({ closesAt, variant = "mini", locale = "en", timeZone, refreshOnClose = false }: { closesAt: string; variant?: "badge" | "mini"; locale?: Locale; timeZone?: string; refreshOnClose?: boolean }) {
  const router = useRouter();
  const { now, synced } = useServerNow();
  const left = now === null ? null : remaining(closesAt, now, 0);
  const level = left === null ? "ok" : urgency(left.totalMs);
  const done = useRef(false);
  useEffect(() => { if (refreshOnClose && left?.done && !done.current) { done.current = true; router.refresh(); } }, [refreshOnClose, left?.done, router]);

  const text = left === null ? "" : left.done ? tx(locale, "Closed") : variant === "mini" ? shortLeft(left) : `${left.days > 0 ? tx(locale, "{n} d", { n: left.days }) + " " : ""}${pad2(left.h)}:${pad2(left.m)}:${pad2(left.s)}`;
  if (variant === "mini") return <span className={`clk mini ${level}`} role="timer" aria-live="off" title={tx(locale, "Time left")}>{text || " "}</span>;

  const fmt = (tz?: string) => new Date(closesAt).toLocaleString(dateLocale(locale), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", ...(tz ? { timeZone: tz } : {}), timeZoneName: "short" });
  const mine = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  return (
    <div className="clk-wrap">
      <div className={`clk badge ${level}`} role="timer" aria-live="off"><span className="l">{tx(locale, "Time left")}</span><span className="t">{text || " "}</span></div>
      <div className="sub">{tx(locale, "Closes {when}", { when: fmt(timeZone || undefined) })}{timeZone && mine && mine !== timeZone ? ` · ${tx(locale, "your time {when}", { when: fmt() })}` : ""}</div>
      <div className="sub">{synced ? tx(locale, "Clock synchronised with the server.") : tx(locale, "Using your device clock; the server decides when bidding closes.")}</div>
    </div>
  );
}
