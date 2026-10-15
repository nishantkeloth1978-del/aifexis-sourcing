import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
export type Env = Record<string, string | undefined>;

/**
 * Encryption of API keys that administrators enter on the Configuration screen. AES-256-GCM. The encryption key is derived (HKDF, with a label of its own)
 * from the server's SIGNING_SECRET, which production already requires, so nothing extra has to be set up. A copy of the database alone cannot be read
 * without it. Each value is bound to its company and provider, so a copied value is useless elsewhere.
 * If SIGNING_SECRET is ever changed, stored keys can no longer be read and must be entered again (nothing is lost but the keys).
 * `env` may carry a secret of its own (tests); the app passes none.
 */
const masterOf = (env: Env) => env.SIGNING_SECRET || process.env.SIGNING_SECRET || "";
export const encryptionReady = (env: Env = {}) => masterOf(env).length >= 24 && masterOf(env) !== "change-me";

const aeskey = (env: Env) => Buffer.from(hkdfSync("sha256", masterOf(env), "aifexis-assistant-keys", "v1", 32));

export function encryptKey(plain: string, tenantId: string, provider: string, env: Env = {}): string {
  if (!encryptionReady(env)) throw new Error("no master key");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", aeskey(env), iv);
  c.setAAD(Buffer.from(`${tenantId}:${provider}`));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

/** The key, or null if it cannot be read (wrong master key, another company's value, damaged). Never throws. */
export function decryptKey(blob: string, tenantId: string, provider: string, env: Env = {}): string | null {
  try {
    if (!encryptionReady(env)) return null;
    const [v, iv, tag, ct] = blob.split(":");
    if (v !== "v1" || !iv || !tag || !ct) return null;
    const d = createDecipheriv("aes-256-gcm", aeskey(env), Buffer.from(iv, "base64"));
    d.setAAD(Buffer.from(`${tenantId}:${provider}`)); d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch { return null; }
}
