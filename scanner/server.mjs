// Aifexis malware scanner: a small HTTPS-fronted wrapper around ClamAV (clamd).
// POST /scan  (Authorization: Bearer <SCAN_TOKEN>, body = raw file bytes)  ->  {"clean": true} or {"clean": false, "signature": "..."}
// GET  /health -> {"ok": true} when clamd answers PING. No file content is stored or logged.
import http from "node:http";
import net from "node:net";
import { timingSafeEqual } from "node:crypto";

/** Scans bytes through clamd's INSTREAM command. Resolves {clean, signature?}; rejects when clamd cannot give an answer. */
/** @param {Buffer} buf @param {{ host?: string, port?: number, timeoutMs?: number }} [opts] @returns {Promise<{ clean: boolean, signature?: string }>} */
export function clamdScan(buf, { host = "127.0.0.1", port = 3310, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let out = ""; let done = false;
    const fail = (e) => { if (!done) { done = true; sock.destroy(); reject(e); } };
    sock.setTimeout(timeoutMs, () => fail(new Error("clamd timeout")));
    sock.on("error", fail);
    sock.on("data", (d) => { out += d.toString("utf8"); });
    sock.on("close", () => {
      if (done) return; done = true;
      const line = out.replace(/\0/g, "").trim();
      if (/ERROR$/.test(line) || !line) return reject(new Error("clamd error: " + line.slice(0, 80)));
      if (/OK$/.test(line)) return resolve({ clean: true });
      const m = line.match(/^stream:\s*(.+?)\s+FOUND$/);
      if (m) return resolve({ clean: false, signature: m[1] });
      reject(new Error("clamd gave an unexpected answer"));
    });
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < buf.length; i += 65536) {
        const chunk = buf.subarray(i, Math.min(buf.length, i + 65536));
        const len = Buffer.alloc(4); len.writeUInt32BE(chunk.length, 0);
        sock.write(len); sock.write(chunk);
      }
      sock.write(Buffer.alloc(4));
    });
  });
}

/** @param {{ host?: string, port?: number, timeoutMs?: number }} [opts] @returns {Promise<boolean>} */
export function clamdPing({ host = "127.0.0.1", port = 3310, timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port }); let out = "";
    sock.setTimeout(timeoutMs, () => { sock.destroy(); resolve(false); });
    sock.on("error", () => resolve(false));
    sock.on("data", (d) => { out += d.toString(); });
    sock.on("close", () => resolve(out.includes("PONG")));
    sock.on("connect", () => sock.write("zPING\0"));
  });
}

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** @param {{ token?: string, clamd?: { host?: string, port?: number, timeoutMs?: number }, maxBytes?: number }} [opts] */
export function createScanner({ token, clamd = {}, maxBytes = 20 * 1024 * 1024 } = {}) {
  if (!token || token.length < 24) throw new Error("SCAN_TOKEN must be set and at least 24 characters long");
  return http.createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
    if (req.method === "GET" && req.url === "/health") { const ok = await clamdPing(clamd); return send(ok ? 200 : 503, { ok }); }
    if (req.method !== "POST" || req.url !== "/scan") return send(404, { error: "not found" });
    const auth = String(req.headers.authorization || "");
    if (!auth.startsWith("Bearer ") || !same(auth.slice(7), token)) return send(401, { error: "unauthorised" });
    const chunks = []; let size = 0; let tooBig = false;
    req.on("data", (c) => { size += c.length; if (size > maxBytes) { tooBig = true; return; } chunks.push(c); });
    req.on("end", async () => {
      if (tooBig) return send(413, { error: "file too large" });
      if (size === 0) return send(400, { error: "empty body" });
      try { send(200, await clamdScan(Buffer.concat(chunks), clamd)); }
      catch { send(502, { error: "scanner unavailable" }); }
    });
    req.on("error", () => send(400, { error: "bad request" }));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createScanner({ token: process.env.SCAN_TOKEN, clamd: { host: process.env.CLAMD_HOST || "clamav", port: Number(process.env.CLAMD_PORT || 3310) }, maxBytes: Number(process.env.MAX_BYTES || 20 * 1024 * 1024) });
  server.listen(Number(process.env.PORT || 8080), () => console.log("scanner listening"));
}
