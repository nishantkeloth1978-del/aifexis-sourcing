"use client";
import LiveClock from "./LiveClock";
import type { Locale } from "@/i18n/dict";

/** Countdown to the closing time on the bid page. Same shared, server-synchronised clock as everywhere else. */
export default function ClosingClock({ closesAt, timeZone, locale = "en" }: { closesAt: string; timeZone: string; locale?: Locale }) {
  return <LiveClock variant="badge" closesAt={closesAt} timeZone={timeZone || "UTC"} locale={locale} refreshOnClose />;
}
