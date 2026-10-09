/** Time left until `closesAt`, split for display. `offsetMs` is serverNow - clientNow. */
export function remaining(closesAtIso: string, clientNowMs: number, offsetMs: number): { done: boolean; days: number; h: number; m: number; s: number; totalMs: number } {
  const total = new Date(closesAtIso).getTime() - (clientNowMs + offsetMs);
  if (!(total > 0)) return { done: true, days: 0, h: 0, m: 0, s: 0, totalMs: 0 };
  const sec = Math.floor(total / 1000);
  return { done: false, days: Math.floor(sec / 86400), h: Math.floor((sec % 86400) / 3600), m: Math.floor((sec % 3600) / 60), s: sec % 60, totalMs: total };
}
export const pad2 = (n: number) => String(n).padStart(2, "0");
/** Estimates the server-minus-client offset from one round trip, assuming the reply took half the trip. */
export function offsetFrom(serverIso: string, sentMs: number, receivedMs: number): number {
  return new Date(serverIso).getTime() - (sentMs + (receivedMs - sentMs) / 2);
}
export const SYNC_EVERY_MS = 5 * 60 * 1000;
