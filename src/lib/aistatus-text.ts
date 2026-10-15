/** Pure parts of the AI status (safe to import in the browser). */
export type Reason = "key_rejected" | "rate_limited" | "unreachable" | "service_error" | "bad_request";
export interface AiStatus { keySet: boolean; lastOkAt: string | null; lastFailAt: string | null; lastReason: string | null; okCount: number; failCount: number }
export const reasonFor = (status: number): Reason => (status === 401 || status === 403 ? "key_rejected" : status === 429 ? "rate_limited" : status >= 500 ? "service_error" : "bad_request");

/** What the person should do, in plain words. */
export function describeAi(s: AiStatus): { level: "off" | "ok" | "idle" | "bad"; text: string } {
  if (!s.keySet) return { level: "off", text: "Not set up: enter a Claude key under Assistant models below." };
  const failedLast = s.lastFailAt && (!s.lastOkAt || s.lastFailAt > s.lastOkAt);
  if (failedLast) {
    const why: Record<string, string> = {
      key_rejected: "The key was rejected. Create a new key in the Anthropic Console and enter it under Assistant models below.",
      rate_limited: "The service is limiting requests, or the spend limit was reached. Check the Anthropic Console.",
      unreachable: "The AI service could not be reached. Try again shortly.",
      service_error: "The AI service had an error. Try again shortly.",
      bad_request: "The AI service refused a request. Check the Claude model name under Assistant models below.",
    };
    return { level: "bad", text: why[s.lastReason ?? ""] ?? "The last AI call failed." };
  }
  if (!s.lastOkAt) return { level: "idle", text: "Key is set but has not been used yet. Use Test now to check it." };
  return { level: "ok", text: "Working." };
}
