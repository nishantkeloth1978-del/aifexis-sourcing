// Simple load test. Usage:
//   node scripts/loadtest.mjs https://your-app.vercel.app [--path /api/health] [--concurrency 20] [--seconds 30] [--cookie "sb-...=..."]
// Without --cookie it tests the public health endpoint. With a staff cookie copied from your browser (Application > Cookies)
// pass a page path such as /  or /evaluations to test signed-in pages. Run it only against your own staging or production with your own account.
const args = process.argv.slice(2);
const base = args[0];
if (!base || base.startsWith("--")) { console.error("Give the base URL first."); process.exit(1); }
const opt = (n, d) => { const i = args.indexOf("--" + n); return i > -1 ? args[i + 1] : d; };
const path = opt("path", "/api/health"), conc = Number(opt("concurrency", 20)), secs = Number(opt("seconds", 30)), cookie = opt("cookie", "");
const lat = [], codes = {};
const end = Date.now() + secs * 1000;
async function worker() {
  while (Date.now() < end) {
    const t = performance.now();
    try {
      const r = await fetch(base + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
      await r.arrayBuffer();
      codes[r.status] = (codes[r.status] ?? 0) + 1;
    } catch { codes.error = (codes.error ?? 0) + 1; }
    lat.push(performance.now() - t);
  }
}
await Promise.all(Array.from({ length: conc }, worker));
lat.sort((a, b) => a - b);
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]?.toFixed(0);
console.log(JSON.stringify({ path, concurrency: conc, seconds: secs, requests: lat.length, perSecond: +(lat.length / secs).toFixed(1), p50ms: +q(0.5), p95ms: +q(0.95), p99ms: +q(0.99), statusCodes: codes }, null, 2));
