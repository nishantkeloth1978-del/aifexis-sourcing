/**
 * Content screening for uploads. This is NOT a full antivirus: it blocks the known-bad and the risky-by-design
 * (test virus signature, executables, macros, scripts and launch actions inside documents) without any external service.
 * For real malware scanning set MALWARE_SCAN_URL to a scanner that answers {"clean": true|false}; it then runs as well, and a
 * scanner that cannot be reached blocks the upload (fail closed).
 */
export type ScanResult = { ok: true; engine: "screened" | "clean" } | { ok: false; error: string };

const EICAR = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE";
const BAD_NAME = /\.(exe|dll|scr|bat|cmd|vbs|vbe|js|jse|wsf|ps1|msi|jar|lnk|com|hta)$/i;

/** Names of the files inside a zip, read from its central directory. Null if it is not a readable zip. */
export function zipNames(b: Buffer): string[] | null {
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) return null;
  const count = b.readUInt16LE(e + 10); let p = b.readUInt32LE(e + 16);
  const names: string[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) return null;
    const len = b.readUInt16LE(p + 28), extra = b.readUInt16LE(p + 30), cmt = b.readUInt16LE(p + 32);
    if (p + 46 + len > b.length) return null;
    names.push(b.subarray(p + 46, p + 46 + len).toString("utf8"));
    p += 46 + len + extra + cmt;
  }
  return names;
}

export function screenBuiltIn(filename: string, bytes: Buffer): { ok: true } | { ok: false; error: string } {
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const head = bytes.subarray(0, 4);
  if (bytes.toString("latin1").includes(EICAR)) return { ok: false, error: "The file was blocked: it contains a virus test signature." };
  const isExe = (head[0] === 0x4d && head[1] === 0x5a) || (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) || (head[0] === 0x23 && head[1] === 0x21)
    || [0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcffaedfe].includes(head.length === 4 ? head.readUInt32BE(0) : 0);
  if (isExe) return { ok: false, error: "The file was blocked: it looks like a program, not a document." };
  if (["zip", "docx", "xlsx"].includes(ext)) {
    const names = zipNames(bytes);
    if (!names) return { ok: false, error: "The file was blocked: the archive could not be checked." };
    if (names.length > 2000) return { ok: false, error: "The file was blocked: the archive has too many files." };
    if (names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n) || /(^|\/)activeX\//i.test(n))) return { ok: false, error: "The file was blocked: it contains macros." };
    if (ext === "zip" && names.some((n) => BAD_NAME.test(n) || /\.(docm|xlsm|pptm)$/i.test(n))) return { ok: false, error: "The file was blocked: the archive contains a program or script." };
  }
  if (ext === "pdf") {
    const s = bytes.toString("latin1");
    if (/\/(JavaScript|Launch)\b/.test(s) || /\/JS\b/.test(s)) return { ok: false, error: "The file was blocked: the PDF contains scripts or launch actions." };
  }
  return { ok: true };
}

export async function scanFile(filename: string, bytes: Buffer, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<ScanResult> {
  const b = screenBuiltIn(filename, bytes);
  if (!b.ok) return b;
  const url = env.MALWARE_SCAN_URL;
  if (!url) return { ok: true, engine: "screened" };
  try {
    const r = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/octet-stream", ...(env.MALWARE_SCAN_TOKEN ? { Authorization: `Bearer ${env.MALWARE_SCAN_TOKEN}` } : {}) }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return { ok: false, error: "The file could not be scanned. Try again later." };
    const j = (await r.json()) as { clean?: boolean };
    return j.clean === true ? { ok: true, engine: "clean" } : { ok: false, error: "The file was blocked by the virus scan." };
  } catch { return { ok: false, error: "The file could not be scanned. Try again later." }; }
}
