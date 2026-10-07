/**
 * Exact decimal helpers on BigInt. No floating point anywhere in the engine.
 * Rounding mode: half up, meaning 0.5 rounds away from zero.
 */

/** Divide n by d (d > 0) rounding half away from zero. */
export function roundDiv(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error("roundDiv: divisor must be positive");
  if (n < 0n) return -((2n * -n + d) / (2n * d));
  return (2n * n + d) / (2n * d);
}

export const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** Parse a decimal string into an integer scaled by 10^scale. Returns null when invalid or too precise. */
export function parseDec(input: unknown, scale: number, opts: { signed?: boolean } = {}): bigint | null {
  const s = String(input ?? "").replace(/,/g, "").trim();
  const re = opts.signed ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/;
  if (!re.test(s)) return null;
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [i = "0", f = ""] = body.split(".");
  if (f.length > scale) return null;
  const v = BigInt(i + f.padEnd(scale, "0"));
  return neg ? -v : v;
}

/** Format a scaled integer with thousands separators. */
export function formatDec(v: bigint | null | undefined, scale = 2, group = true): string {
  if (v == null) return "-";
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const s = abs.toString().padStart(scale + 1, "0");
  const intPart = s.slice(0, s.length - scale);
  const frac = s.slice(s.length - scale);
  const ip = group ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : intPart;
  return (neg ? "-" : "") + ip + (scale > 0 ? "." + frac : "");
}

/** Re-scale a value from one scale to another, rounding half up when reducing precision. */
export function rescale(v: bigint, from: number, to: number): bigint {
  if (to >= from) return v * pow10(to - from);
  return roundDiv(v, pow10(from - to));
}
