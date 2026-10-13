import { describe, expect, it } from "vitest";
import { sslFor } from "@/lib/dbssl";
import { signingSecretFrom } from "@/authz/service";
import { POST } from "../app/api/messages/inbound/route";

describe("database certificate checking", () => {
  const url = "postgresql://u:p@aws-0-eu.pooler.supabase.com:6543/postgres";
  it("verifies against a supplied authority, with escaped newlines accepted", () => {
    const c = sslFor(url, { DATABASE_SSL_CA: "-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----" });
    expect(c.mode).toBe("ca");
    expect(c.options).toMatchObject({ rejectUnauthorized: true });
    expect((c.options as { ca: string }).ca).toContain("\nABC\n");
  });
  it("can verify against the system authorities", () => expect(sslFor(url, { DATABASE_SSL_VERIFY: "system" })).toMatchObject({ mode: "system", options: { rejectUnauthorized: true } }));
  it("says plainly when it is not verifying, and uses no TLS locally", () => {
    expect(sslFor(url, {}).mode).toBe("unverified");
    expect(sslFor("postgresql://u@localhost:5432/x", {}).mode).toBe("none");
    expect(sslFor("postgresql://u@127.0.0.1:5432/x", {}).mode).toBe("none");
  });
});

describe("signing secret", () => {
  it("is mandatory and strong in production", () => {
    expect(() => signingSecretFrom({ NODE_ENV: "production" })).toThrow();
    expect(() => signingSecretFrom({ NODE_ENV: "production", SIGNING_SECRET: "change-me" })).toThrow();
    expect(() => signingSecretFrom({ NODE_ENV: "production", SIGNING_SECRET: "short" })).toThrow();
    expect(signingSecretFrom({ NODE_ENV: "production", SIGNING_SECRET: "x".repeat(32) })).toBe("x".repeat(32));
  });
  it("keeps a development fallback outside production", () => expect(signingSecretFrom({ NODE_ENV: "test" })).toBe("dev-only-secret"));
});

describe("inbound mail endpoint", () => {
  const call = (url: string, headers: Record<string, string>) => POST(new Request(url, { method: "POST", headers, body: "{}" }));
  it("refuses the secret in the URL and accepts header or basic authentication", async () => {
    process.env.MESSAGES_INBOUND_SECRET = "s3cret-value";
    try {
      const big = { "content-length": String(30 * 1024 * 1024) };
      expect((await call("https://x.test/api/messages/inbound?key=s3cret-value", big)).status).toBe(404);
      expect((await call("https://x.test/api/messages/inbound", { ...big, "x-inbound-secret": "wrong" })).status).toBe(404);
      expect((await call("https://x.test/api/messages/inbound", { ...big, "x-inbound-secret": "s3cret-value" })).status).toBe(413);
      const basic = "Basic " + Buffer.from("postmark:s3cret-value").toString("base64");
      expect((await call("https://x.test/api/messages/inbound", { ...big, authorization: basic })).status).toBe(413);
    } finally { delete process.env.MESSAGES_INBOUND_SECRET; }
  });
});
