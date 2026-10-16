// Bridge between a local ERPNext and Aifexis Sourcing. Runs on YOUR computer: it only makes outgoing calls, so ERPNext never has to be reachable from the internet.
//   npx tsx scripts/erpnext-bridge.ts push   [--dry]   submitted ERPNext Material Requests (type Purchase, pending) -> Aifexis requests
//   npx tsx scripts/erpnext-bridge.ts pull   [--dry]   approved Aifexis awards -> DRAFT ERPNext Purchase Orders (a person submits them in ERPNext)
//   npx tsx scripts/erpnext-bridge.ts run    [--dry]   push, then pull
//   npx tsx scripts/erpnext-bridge.ts watch  [--every 60]   run again and again until you press Ctrl+C: new requirements in ERPNext become events in Aifexis on their own
// Keys are asked for with hidden typing and are never written to disk or printed.
import { ask, closeAsk } from "./lib/ask";
import { awardToPo, mrToRequest, type AwardDoc, type MaterialRequest } from "../src/bridge/erpnext";

const cmd = process.argv[2] ?? "run"; const dry = process.argv.includes("--dry");
const everyArg = process.argv.indexOf("--every"); const every = Math.max(15, Number(process.argv[everyArg + 1]) || 60);
if (!["push", "pull", "run", "watch"].includes(cmd)) { console.error("Use: push, pull, run or watch (add --dry to only show what would happen; watch repeats every 60 seconds, or --every N)."); process.exit(1); }

async function main() {
  const erp = ((await ask("ERPNext address [http://127.0.0.1:18080]: ")) || "http://127.0.0.1:18080").replace(/\/+$/, "");
  const site = ((await ask("Aifexis address [https://aifexis-sourcing.vercel.app]: ")) || "https://aifexis-sourcing.vercel.app").replace(/\/+$/, "");
  const currency = ((await ask("Currency for requests and orders [AED]: ")) || "AED").toUpperCase();
  const erpKey = await ask("ERPNext API key (typing is hidden): ", true);
  const erpSecret = await ask("ERPNext API secret (typing is hidden): ", true);
  const aifKey = await ask("Aifexis integration key, starts with aifx_ (typing is hidden): ", true);
  closeAsk();
  if (!/^aifx_[0-9a-f]{12}_/.test(aifKey)) { console.error("That is not an Aifexis key (it starts with aifx_)."); return; }
  const E = { Authorization: `token ${erpKey}:${erpSecret}`, Accept: "application/json" };
  const A = { Authorization: `Bearer ${aifKey}`, Accept: "application/json" };
  const erpGet = async (path: string) => { const r = await fetch(`${erp}${path}`, { headers: E }); if (!r.ok) throw new Error(`ERPNext ${r.status} on ${path.split("?")[0]}`); return (await r.json()).data; };
  const aif = async (path: string, init?: RequestInit) => { const r = await fetch(`${site}/api/v1${path}`, { ...init, headers: { ...A, ...(init?.headers as object) } }); let body: unknown = null; try { body = await r.json(); } catch { /* none */ } return { status: r.status, body: body as Record<string, any> }; }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const q = (o: unknown) => encodeURIComponent(JSON.stringify(o));

  async function cycle(mode: string) {
    const list: { name: string }[] = await erpGet(`/api/resource/Material%20Request?filters=${q([["docstatus", "=", 1], ["material_request_type", "=", "Purchase"], ["status", "=", "Pending"]])}&fields=${q(["name"])}&limit_page_length=50`);
    console.log(`ERPNext: ${list.length} pending purchase Material Request(s).`);
    const mrs = new Map<string, MaterialRequest>();
    for (const { name } of list) mrs.set(name, await erpGet(`/api/resource/Material%20Request/${encodeURIComponent(name)}`));

    if (mode === "push" || mode === "run") {
      for (const mr of mrs.values()) {
        const m = mrToRequest(mr, currency);
        if (!m.ok) { console.log(`  skip  ${m.error}`); continue; }
        if (dry) { console.log(`  would send ${mr.name}: ${(m.body.lines as unknown[]).length} line(s)`); continue; }
        const r = await aif("/requests", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `erpnext-${mr.name}`.slice(0, 100) }, body: JSON.stringify(m.body) });
        console.log(r.status === 201 ? `  sent  ${mr.name} -> ${r.body?.reference}${r.body?.eventReference ? ` (event ${r.body.eventReference} created)` : ""}` : r.status === 200 ? `  known ${mr.name} -> ${r.body?.reference}` : `  FAILED ${mr.name}: ${r.status} ${r.body?.error?.message ?? ""}`);
      }
    }

    if (mode === "pull" || mode === "run") {
      for (const mr of mrs.values()) {
        const rq = await aif(`/requests/${encodeURIComponent(mr.name)}`);
        if (rq.status !== 200) continue;
        const evRef = rq.body?.eventReference as string | null;
        if (!evRef) { console.log(`  wait  ${mr.name}: request is ${rq.body?.state}, no event yet`); continue; }
        const aw = await aif(`/events/${encodeURIComponent(evRef)}/award`);
        if (aw.status === 409) { console.log(`  wait  ${mr.name}: event ${evRef} is not awarded yet`); continue; }
        if (aw.status !== 200) { console.log(`  FAILED ${mr.name}: award ${aw.status} ${aw.body?.error?.message ?? ""}`); continue; }
        for (const doc of aw.body.awards as (AwardDoc & { vendor: { name: string; vendorCode?: string } })[]) {
          const conf = `${doc.eventRef}-${doc.vendor.vendorCode || doc.vendor.name}`.slice(0, 140);
          const have: { name: string }[] = await erpGet(`/api/resource/Purchase%20Order?filters=${q([["order_confirmation_no", "=", conf]])}&fields=${q(["name"])}`);
          if (have.length) { console.log(`  known ${mr.name}: ${have[0]!.name} already exists for ${doc.vendor.name}`); continue; }
          const byId: { name: string }[] = doc.vendor.vendorCode ? await erpGet(`/api/resource/Supplier?filters=${q([["name", "=", doc.vendor.vendorCode]])}&fields=${q(["name"])}`) : [];
          const byName: { name: string }[] = byId.length ? byId : await erpGet(`/api/resource/Supplier?filters=${q([["supplier_name", "=", doc.vendor.name]])}&fields=${q(["name"])}`);
          if (!byName.length) { console.log(`  FAILED ${mr.name}: no ERPNext Supplier matches "${doc.vendor.vendorCode || doc.vendor.name}". Create it or set the vendor number to its ERPNext Supplier ID.`); continue; }
          const po = awardToPo(doc, mr, byName[0]!.name, new Date().toISOString().slice(0, 10));
          if (!po.ok) { console.log(`  FAILED ${mr.name}: ${po.errors.join(" ")}`); continue; }
          if (dry) { console.log(`  would create a draft Purchase Order for ${doc.vendor.name}: ${po.po.items.length} line(s), ${doc.totalNet} ${doc.currency}`); continue; }
          const r = await fetch(`${erp}/api/resource/Purchase%20Order`, { method: "POST", headers: { ...E, "Content-Type": "application/json" }, body: JSON.stringify(po.po) });
          const j = await r.json().catch(() => ({}));
          console.log(r.ok ? `  made  draft Purchase Order ${j.data?.name} for ${doc.vendor.name} (open it in ERPNext and submit)` : `  FAILED ${mr.name}: ERPNext ${r.status} ${String(j.exception ?? j._server_messages ?? "").slice(0, 300)}`);
        }
      }
    }

  }
  if (cmd !== "watch") { await cycle(cmd); return; }
  console.log(`Watching ERPNext every ${every} seconds. Press Ctrl+C to stop.`);
  for (;;) {
    console.log(`[${new Date().toLocaleTimeString()}]`);
    try { await cycle("run"); } catch (e) { console.error(`  problem: ${e instanceof Error ? e.message : "unknown error"} (will try again)`); }
    await new Promise((r) => setTimeout(r, every * 1000));
  }
}
main().catch((e) => { console.error(`Stopped: ${e instanceof Error ? e.message : "unknown error"}`); process.exit(1); });
