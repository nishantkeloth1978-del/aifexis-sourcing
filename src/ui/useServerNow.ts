"use client";
import { useEffect, useState } from "react";
import { offsetFrom, SYNC_EVERY_MS } from "@/lib/clock";

/** One shared clock for every countdown on the page: one server sync every few minutes, one tick a second, however many clocks are shown. */
const subs = new Set<(n: number) => void>();
let offset = 0, synced = false, tickTimer: ReturnType<typeof setInterval> | null = null, syncTimer: ReturnType<typeof setInterval> | null = null;

async function sync() {
  const sent = Date.now();
  try {
    const j = (await (await fetch("/api/time", { cache: "no-store" })).json()) as { now: string };
    offset = offsetFrom(j.now, sent, Date.now()); synced = true;
  } catch { synced = false; }
}
function start() {
  if (tickTimer) return;
  void sync();
  syncTimer = setInterval(sync, SYNC_EVERY_MS);
  tickTimer = setInterval(() => { const n = Date.now() + offset; subs.forEach((f) => f(n)); }, 1000);
}
function stop() {
  if (subs.size) return;
  if (tickTimer) clearInterval(tickTimer); if (syncTimer) clearInterval(syncTimer);
  tickTimer = syncTimer = null;
}

/** Server-corrected time in ms, or null until the first tick on the client (keeps server and client markup identical). */
export function useServerNow(): { now: number | null; synced: boolean } {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    subs.add(setNow); start(); setNow(Date.now() + offset);
    return () => { subs.delete(setNow); stop(); };
  }, []);
  return { now, synced };
}
