/** Pure parts of the scanner status (safe to import in the browser). */
export type ScanReason = "rejected_token" | "unreachable" | "timeout" | "scanner_error" | "bad_answer";
export interface ScanStatus { configured: boolean; lastOkAt: string | null; lastFailAt: string | null; lastReason: string | null; okCount: number; failCount: number }

export function describeScan(s: ScanStatus): { level: "builtin" | "ok" | "idle" | "bad"; text: string } {
  if (!s.configured) return { level: "builtin", text: "Built-in screening only (blocks programs, macros, scripts and the test virus). It is not a full antivirus. Set MALWARE_SCAN_URL to add a real scanner." };
  const failedLast = s.lastFailAt && (!s.lastOkAt || s.lastFailAt > s.lastOkAt);
  if (failedLast) {
    const why: Record<string, string> = {
      rejected_token: "The scanner refused the token. Check MALWARE_SCAN_TOKEN in Vercel and on the scanner.",
      unreachable: "The scanner could not be reached. Uploads are blocked until it is back.",
      timeout: "The scanner took too long to answer. Uploads are blocked until it responds.",
      scanner_error: "The scanner reported an error (is the virus database loaded?). Uploads are blocked.",
      bad_answer: "The scanner answered in a way this application does not understand.",
    };
    return { level: "bad", text: why[s.lastReason ?? ""] ?? "The last scan failed. Uploads are blocked until the scanner works." };
  }
  if (!s.lastOkAt) return { level: "idle", text: "A scanner is set up but has not scanned anything yet. Use Test now to check it." };
  return { level: "ok", text: "Scanner working." };
}
