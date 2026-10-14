/**
 * The Content-Security-Policy for one response. Scripts run only when they carry this response's nonce (or were started by a script that did),
 * so injected markup cannot run script even if some text escaped. Styles still allow inline attributes, which React uses widely.
 */
export function buildCsp(nonce: string, opts: { supabase?: string; dev?: boolean } = {}): string {
  const supabase = opts.supabase ?? "";
  return [
    "default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    `connect-src 'self' ${supabase} https://*.supabase.co`.replace(/\s+/g, " ").trim(),
    "font-src 'self' data:", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join("; ");
}

/** A fresh random nonce, safe in a header (base64). */
export function newNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
