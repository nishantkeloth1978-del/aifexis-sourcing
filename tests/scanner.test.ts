import net from "node:net";
import type { AddressInfo } from "node:net";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EICAR_TEST, scanFile, testScanner } from "@/files/scan";
import { describeScan, getScanStatus, recordScan } from "@/lib/scanstatus";
import { adminClient, makePool } from "./helpers/db";
import { clamdPing, clamdScan, createScanner } from "../scanner/server.mjs";

const env = { MALWARE_SCAN_URL: "https://scan.example/scan", MALWARE_SCAN_TOKEN: "t" } as unknown as NodeJS.ProcessEnv;
const doc = Buffer.from("%PDF-1.4\nhello\n");
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("scanFile with an external scanner", () => {
  it("passes clean files, blocks infected ones, and fails closed on every other answer", async () => {
    expect(await scanFile("a.pdf", doc, env, reply(200, { clean: true }))).toEqual({ ok: true, engine: "clean" });
    expect(await scanFile("a.pdf", doc, env, reply(200, { clean: false }))).toMatchObject({ ok: false, error: expect.stringContaining("virus scan") });
    for (const f of [reply(401, {}), reply(500, {}), reply(200, { nope: 1 }), reply(200, { clean: "yes" }), (async () => { throw new Error("down"); }) as unknown as typeof fetch])
      expect(await scanFile("a.pdf", doc, env, f)).toMatchObject({ ok: false, error: expect.stringContaining("could not be scanned") });
  });
  it("sends the token and the bytes", async () => {
    let seen: { auth?: string; len?: number } = {};
    const f = (async (_u: unknown, init?: RequestInit) => { seen = { auth: (init?.headers as Record<string, string>).Authorization, len: (init?.body as Uint8Array).length }; return new Response(JSON.stringify({ clean: true }), { status: 200 }); }) as unknown as typeof fetch;
    await scanFile("a.pdf", doc, env, f);
    expect(seen).toEqual({ auth: "Bearer t", len: doc.length });
  });
  it("still applies the built-in screening first", async () => {
    let called = false;
    const f = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
    expect(await scanFile("evil.exe", Buffer.from("MZ....."), env, f)).toMatchObject({ ok: false });
    expect(called).toBe(false);
  });
});

describe("testScanner", () => {
  const smart = (async (_u: unknown, init?: RequestInit) => new Response(JSON.stringify({ clean: !Buffer.from(init!.body as Uint8Array).toString("latin1").includes("EICAR-STANDARD") }), { status: 200 })) as unknown as typeof fetch;
  it("needs the test virus flagged and the harmless file passed", async () => {
    expect(await testScanner(env, smart)).toEqual({ ok: true });
    expect(await testScanner(env, reply(200, { clean: true }))).toMatchObject({ ok: false, error: expect.stringContaining("passed the standard test virus") });
    expect(await testScanner(env, reply(200, { clean: false }))).toMatchObject({ ok: false, error: expect.stringContaining("harmless") });
    expect(await testScanner(env, reply(401, {}))).toMatchObject({ ok: false });
    expect(await testScanner({} as NodeJS.ProcessEnv, smart)).toMatchObject({ ok: false });
  });
});

/** A stand-in for clamd: understands PING and INSTREAM, flags the EICAR test string. */
function fakeClamd(): Promise<net.Server> {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        if (buf.subarray(0, 6).toString() === "zPING\0") { sock.end("PONG\0"); return; }
        if (buf.subarray(0, 10).toString() === "zINSTREAM\0") {
          let p = 10; let body = Buffer.alloc(0);
          while (p + 4 <= buf.length) { const n = buf.readUInt32BE(p); p += 4; if (n === 0) { sock.end(body.toString("latin1").includes("EICAR-STANDARD") ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0"); return; } if (p + n > buf.length) break; body = Buffer.concat([body, buf.subarray(p, p + n)]); p += n; }
        }
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

describe("scanner service (clamd wrapper)", () => {
  let clamd: net.Server, web: ReturnType<typeof createScanner>, base = "";
  const TOKEN = "x".repeat(32);
  beforeAll(async () => {
    clamd = await fakeClamd();
    web = createScanner({ token: TOKEN, clamd: { host: "127.0.0.1", port: (clamd.address() as AddressInfo).port }, maxBytes: 200_000 });
    await new Promise<void>((r) => web.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
  });
  afterAll(() => { web.close(); clamd.close(); });
  const post = (body: Buffer | string, token = TOKEN) => fetch(base + "/scan", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: body as BodyInit });

  it("refuses to start without a long token", () => { expect(() => createScanner({ token: "short" })).toThrow(); expect(() => createScanner({})).toThrow(); });
  it("scans through clamd INSTREAM", async () => {
    const port = (clamd.address() as AddressInfo).port;
    expect(await clamdScan(Buffer.from("hello"), { port })).toEqual({ clean: true });
    expect(await clamdScan(Buffer.from(EICAR_TEST, "latin1"), { port })).toEqual({ clean: false, signature: "Eicar-Test-Signature" });
    expect(await clamdScan(Buffer.alloc(300_000, 65), { port })).toEqual({ clean: true });   // several chunks
    expect(await clamdPing({ port })).toBe(true);
  });
  it("answers over HTTP with authentication, size limit and health", async () => {
    expect(await (await post("hello")).json()).toEqual({ clean: true });
    expect(await (await post(Buffer.from(EICAR_TEST, "latin1"))).json()).toMatchObject({ clean: false, signature: "Eicar-Test-Signature" });
    expect((await post("hello", "wrong".repeat(8))).status).toBe(401);
    expect((await fetch(base + "/scan", { method: "POST", body: "hello" })).status).toBe(401);
    expect((await post(Buffer.alloc(300_000, 1))).status).toBe(413);
    expect((await post("")).status).toBe(400);
    expect((await fetch(base + "/nothing")).status).toBe(404);
    expect(await (await fetch(base + "/health")).json()).toEqual({ ok: true });
  });
  it("works end to end with the app's scanFile and testScanner", async () => {
    const e = { MALWARE_SCAN_URL: base + "/scan", MALWARE_SCAN_TOKEN: TOKEN } as unknown as NodeJS.ProcessEnv;
    const viaHttp = ((u: string, i?: RequestInit) => fetch(u, i)) as unknown as typeof fetch;
    expect(await scanFile("a.pdf", doc, e, viaHttp)).toEqual({ ok: true, engine: "clean" });
    expect(await testScanner(e, viaHttp)).toEqual({ ok: true });
    expect(await testScanner({ ...e, MALWARE_SCAN_TOKEN: "w".repeat(32) } as NodeJS.ProcessEnv, viaHttp)).toMatchObject({ ok: false });
  });
  it("reports a clamd outage as 502", async () => {
    const down = createScanner({ token: TOKEN, clamd: { host: "127.0.0.1", port: 1 } });
    await new Promise<void>((r) => down.listen(0, "127.0.0.1", r));
    const r = await fetch(`http://127.0.0.1:${(down.address() as AddressInfo).port}/scan`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: "x" });
    expect(r.status).toBe(502);
    expect((await fetch(`http://127.0.0.1:${(down.address() as AddressInfo).port}/health`)).status).toBe(503);
    down.close();
  });
});

let admin: Client, pool: Pool;
describe("scanner status", () => {
  beforeAll(async () => { admin = await adminClient(); pool = makePool(); await admin.query(`delete from service_status where service = 'scanner'`); });
  afterAll(async () => { await pool.end(); await admin.end(); });
  it("records through the runtime role and explains each state", async () => {
    expect(describeScan(await getScanStatus(pool, {} as NodeJS.ProcessEnv)).level).toBe("builtin");
    const cfg = { MALWARE_SCAN_URL: "https://x" } as unknown as NodeJS.ProcessEnv;
    expect(describeScan(await getScanStatus(pool, cfg)).level).toBe("idle");
    await recordScan(false, "unreachable", pool);
    expect(describeScan(await getScanStatus(pool, cfg))).toMatchObject({ level: "bad" });
    await new Promise((r) => setTimeout(r, 15));
    await recordScan(true, undefined, pool);
    expect(describeScan(await getScanStatus(pool, cfg))).toEqual({ level: "ok", text: "Scanner working." });
    expect((await admin.query(`select has_table_privilege('app_runtime', 'service_status', 'select') as a`)).rows[0].a).toBe(false);
  });
});
