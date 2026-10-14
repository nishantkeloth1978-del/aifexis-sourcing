import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBidForm, submitBidForm } from "@/bids/service";
import { laneSheet, parseLaneSheet } from "@/bids/lanesheet";
import { getCommercialView } from "@/commercial/service";
import type { Who } from "@/events/service";
import type { SupplierWho } from "@/suppliers/service";
import { createEventFromTemplate } from "@/templates/events";
import { activate, saveProfile } from "@/templates/service";
import { isRequired, isVisible, type Answers } from "@/templates/response";
import { adminClient, makePool, seedTenant, type World } from "./helpers/db";
import { openCommercialConfirmed } from "./helpers/confirmed";

/** A full freight tender at scale: 100 lanes, 5 carriers with different coverage, bids by screen and by Excel, then the buyer's comparison. */
const ORIGINS = [["Khalifa Port", "AEKHL"], ["Jebel Ali", "AEJEA"], ["Ruwais", "AERUW"], ["Fujairah", "AEFJR"]] as const;
const DESTS = ["Nhava Sheva", "Mundra", "Karachi", "Shanghai", "Ningbo", "Qingdao", "Singapore", "Port Klang", "Jakarta", "Colombo", "Mersin", "Rotterdam", "Antwerp", "Hamburg", "Genoa", "Durban", "Mombasa", "Dar es Salaam", "Santos", "Houston", "Busan", "Yokohama", "Jeddah", "Aqaba", "Alexandria"];
const REGION: Record<string, number> = Object.fromEntries(DESTS.map((d, i) => [d, i < 3 ? 0 : i < 10 ? 1 : i < 16 ? 2 : i < 19 ? 3 : i < 22 ? 4 : 5]));   // 0 South Asia, 1 Far East, 2 Europe, 3 Africa/S.America, 4 N.Asia/US, 5 Red Sea
const BASE = [1100, 1500, 2400, 2800, 3100, 700];       // ocean freight per 40' HC by region
const DAYS = [8, 22, 26, 30, 32, 6];
let seed = 20261014; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

const LANES = ORIGINS.flatMap(([o, oc]) => DESTS.map((d) => ({ origin: o, origin_code: oc, destination: d, dest_code: d.slice(0, 5).toUpperCase(), container: "40' HC", incoterm: "CIF", cargo: "Polyethylene bags", volume: String(20 + Math.floor(rnd() * 380)), max_transit: String(DAYS[REGION[d]!]! + 2) })));
// five carriers: factor on the base price, and which regions they serve
const CARRIERS = [
  { name: "Carrier 1", factor: 1.0, regions: [0, 1, 2, 3, 4, 5], via: "screen" },
  { name: "Carrier 2", factor: 0.93, regions: [0, 1, 2, 3, 4, 5], via: "excel" },
  { name: "Carrier 3", factor: 1.08, regions: [0, 1, 2, 4, 5], via: "screen" },
  { name: "Carrier 4", factor: 0.88, regions: [0, 1, 5], via: "screen" },
  { name: "Carrier 5", factor: 0.97, regions: [2, 3, 5], via: "excel" },
] as const;
const comps = (lane: (typeof LANES)[number], f: number) => { const b = BASE[REGION[lane.destination]!]! * f * (0.9 + rnd() * 0.2); return [b, b * 0.2, 95, 60 + rnd() * 120, 70].map((x) => Math.round(x)); };

let admin: Client, pool: Pool, W: World;
const buyer = (): Who => ({ tenantId: W.tenantId, userId: W.people.buyer.userId, membershipId: W.people.buyer.membershipId, role: "member" } as Who);
const adminOf = (): Who => ({ tenantId: W.tenantId, userId: W.people.admin.userId, membershipId: W.people.admin.membershipId, role: "admin" } as Who);
const asSupplier = async <T,>(fn: () => Promise<T>): Promise<T> => { process.env.DB_RUNTIME_ROLE = "app_supplier"; try { return await fn(); } finally { delete process.env.DB_RUNTIME_ROLE; } };
beforeAll(async () => {
  admin = await adminClient(); pool = makePool(); W = await seedTenant(admin, "freight-100");
  await saveProfile(pool, adminOf(), { primaryIndustry: "LOGISTICS", categories: ["FREIGHT"], country: "ae", currency: "USD", timeZone: "Asia/Dubai", defaultLanguage: "en", languages: ["en"] }, 0);
  const a = await activate(pool, adminOf(), ["LOG_FREIGHT_RFQ"], randomUUID(), 0);
  if (!a.ok) throw new Error(a.error);
});
afterAll(async () => { delete process.env.DB_RUNTIME_ROLE; await pool.end(); await admin.end(); });

describe("freight tender with 100 lanes and 5 carriers", () => {
  it("runs from template to comparison and the figures match the raw bids", async () => {
    const t0 = Date.now(); const lap: Record<string, number> = {};
    const mark = (k: string, from: number) => { lap[k] = Date.now() - from; };

    // five suppliers (the fixture has three)
    const sups = [...W.suppliers.map((s) => ({ id: s.id, supplierUserId: s.supplierUserId }))];
    for (const n of [4, 5]) {
      const s = (await admin.query(`insert into supplier_org (tenant_id, name) values ($1,$2) returning id`, [W.tenantId, `Supplier ${n}`])).rows[0].id as string;
      const u = (await admin.query(`insert into app_user (email) values ($1) returning id`, [`supplier${n}-${randomUUID()}@test.local`])).rows[0].id as string;
      sups.push({ id: s, supplierUserId: (await admin.query(`insert into supplier_user (tenant_id, supplier_id, user_id) values ($1,$2,$3) returning id`, [W.tenantId, s, u])).rows[0].id as string });
    }
    const who = (i: number): SupplierWho => ({ tenantId: W.tenantId, supplierId: sups[i]!.id, supplierUserId: sups[i]!.supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });

    let s = Date.now();
    const e = await createEventFromTemplate(pool, buyer(), { templateKey: "LOG_FREIGHT_RFQ", title: "Polymer exports 2027, 100 lanes", idempotencyKey: randomUUID(), inputs: { groups: { lane: LANES } }, values: { contract_period: "2027" } });
    if (!e.ok) throw new Error(e.error);
    const id = e.event.id; mark("create event from template (100 lanes, 500 lines, 100 lots)", s);
    expect(e.schedule.items).toHaveLength(500);
    expect((await admin.query(`select count(*)::int n from event_lot where event_id = $1`, [id])).rows[0].n).toBe(100);

    await admin.query(`update sourcing_event set state = 'published', closes_at = now() + interval '1 day' where id = $1`, [id]);
    for (const x of sups) await admin.query(`insert into invitation (tenant_id, event_id, supplier_id, supplier_user_id, token_hash) values ($1,$2,$3,$4,$5)`, [W.tenantId, id, x.id, x.supplierUserId, randomUUID()]);

    const raw: Record<string, Record<number, { p: number[]; transit: number }>> = {};
    for (const [ci, c] of CARRIERS.entries()) {
      s = Date.now();
      const form = (await asSupplier(() => getBidForm(pool, who(ci), id)))!;
      const grid = form.laneGrid!;
      expect(grid.lanes).toHaveLength(100);
      raw[c.name] = {};
      let prices: Record<string, string> = {}; let terms: Record<string, Record<string, string>> = {};
      grid.lanes.forEach((lane, li) => {
        const L = LANES[li]!;
        if (!(c.regions as readonly number[]).includes(REGION[L.destination]!)) return;
        const p = comps(L, c.factor), transit = DAYS[REGION[L.destination]!]! + Math.round((rnd() - 0.4) * 6);
        raw[c.name]![li] = { p, transit };
        grid.components.forEach((k, ki) => { prices[lane.items[k.lineKey]!] = String(p[ki]); });
        terms[lane.key] = { transit_days: String(transit), sailings_week: String(1 + Math.floor(rnd() * 6)), free_days: "7", valid_until: "2027-12-31" };
      });
      if (c.via === "excel") {                                   // the same data, through the downloaded sheet
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await laneSheet(form)) as unknown as ArrayBuffer);
        const ws = wb.getWorksheet("Lane prices")!; const head = ws.getRow(5).values as (string | undefined)[];
        const col = (n: string) => head.findIndex((h) => h === n);
        grid.lanes.forEach((lane, li) => {
          const r = raw[c.name]![li]; if (!r) return;
          grid.components.forEach((k, ki) => { ws.getRow(6 + li).getCell(col(`${k.label.en} (USD)`)).value = r.p[ki]; });
          const t = terms[lane.key]!;
          ws.getRow(6 + li).getCell(col("Transit offered (days)")).value = Number(t.transit_days); ws.getRow(6 + li).getCell(col("Sailings per week")).value = Number(t.sailings_week);
          ws.getRow(6 + li).getCell(col("Free days (detention)")).value = 7; ws.getRow(6 + li).getCell(col("Rate valid until")).value = new Date("2027-12-31T00:00:00Z");
        });
        const parsed = await parseLaneSheet("bid.xlsx", Buffer.from(await wb.xlsx.writeBuffer()), form);
        if ("fatal" in parsed) throw new Error(parsed.fatal);
        expect(parsed.errors).toEqual([]);
        expect(Object.keys(parsed.prices)).toHaveLength(Object.keys(prices).length);
        prices = parsed.prices; terms = parsed.terms;
      }
      const answers: Answers = {};
      for (const a of form.questionnaire!.asks) if (isVisible(a, answers) && isRequired(a, answers)) answers[a.key] = a.type === "boolean" || a.type === "yesno" ? true : a.type === "single" ? a.options![0]!.key : a.type === "integer" || a.type === "decimal" || a.type === "money" ? "30" : a.type === "date" ? "2027-01-31" : "Yes, as described.";
      const res = await asSupplier(() => submitBidForm(pool, who(ci), id, { prices, laneTerms: terms, answers, technicalText: `${c.name} offers weekly sailings on the lanes it prices.`, gates: Object.fromEntries(form.gates.map((g) => [g, true])) }));
      expect(res, c.name).toMatchObject({ ok: true });
      mark(`${c.name}: fill and submit ${Object.keys(raw[c.name]!).length} lanes by ${c.via}`, s);
    }

    s = Date.now();
    await admin.query(`update sourcing_event set state = 'technical_approved', envelope1_opened_at = now(), closes_at = now() - interval '1 day' where id = $1`, [id]);
    for (const [who2, role] of [["buyer", "buyer"], ["witness", "witness"], ["comm", "comm_evaluator"], ["awardApprover", "award_approver"]] as const)
      await admin.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,$4)`, [W.tenantId, id, W.people[who2].membershipId, role]);
    for (const x of sups) {
      await admin.query(`insert into tech_result (tenant_id, event_id, supplier_id, total, qualified) values ($1,$2,$3,80,true)`, [W.tenantId, id, x.id]);
      await admin.query(`insert into qualified_bidder (tenant_id, event_id, supplier_id) values ($1,$2,$3)`, [W.tenantId, id, x.id]);
    }
    const ver = (await admin.query(`select state_version from sourcing_event where id = $1`, [id])).rows[0].state_version as number;
    expect(await openCommercialConfirmed(pool, buyer(), id, ver, W.people.witness.membershipId)).toMatchObject({ ok: true });
    s = Date.now();
    const view = (await getCommercialView(pool, buyer(), id))!; mark("buyer comparison (100 lanes x 5 carriers)", s);
    const m = view.comparison!.laneMatrix!;
    expect(m.rows).toHaveLength(100); expect(m.suppliers).toHaveLength(5); expect(view.comparison!.lots).toHaveLength(100);

    // check against the raw bids, computed here from scratch
    const allIn = (c: string, li: number) => raw[c]![li] ? raw[c]![li]!.p.reduce((a, b) => a + b, 0) : null;
    const nameOf = new Map(m.suppliers.map((x, i) => [x.supplierId, CARRIERS[i]!.name]));
    void nameOf;
    let byLane = 0, covered = 0; const wins: Record<string, number> = {};
    LANES.forEach((L, li) => {
      const offers: [string, number][] = [];
      for (const c of CARRIERS) { const v = allIn(c.name, li); if (v !== null) offers.push([c.name, v]); }
      if (!offers.length) return;
      const best = offers.reduce((a, b) => (b[1] < a[1] ? b : a));
      byLane += best[1] * Number(L.volume); covered++; wins[best[0]] = (wins[best[0]] ?? 0) + 1;
      const row = m.rows[li]!;
      expect(Number(row.cells[m.suppliers.find((x) => x.name === "Supplier " + (CARRIERS.findIndex((c) => c.name === best[0]) + 1))?.supplierId ?? ""]?.allIn ?? row.cells[row.lowest!]!.allIn)).toBeCloseTo(best[1], 1);
    });
    expect(covered).toBe(m.byLane.lanesCovered);
    expect(Number(m.byLane.annual)).toBeCloseTo(byLane, 0);
    const singles = CARRIERS.map((c) => ({ c: c.name, total: LANES.every((_, li) => raw[c.name]![li]) ? LANES.reduce((a, L, li) => a + allIn(c.name, li)! * Number(L.volume), 0) : null }));
    const bestSingle = singles.filter((x) => x.total !== null).sort((a, b) => a.total! - b.total!)[0]!;
    expect(Number(m.bestSingle!.annual)).toBeCloseTo(bestSingle.total!, 0);
    expect(m.single.filter((x) => x.annual === null).length).toBe(singles.filter((x) => x.total === null).length);

    mark("total", t0);
    writeFileSync("/tmp/sim_freight_100.json", JSON.stringify({ lap, lanes: 100, carriers: CARRIERS.map((c) => ({ name: c.name, via: c.via, lanesPriced: Object.keys(raw[c.name]!).length })), bestSingle, byLane: m.byLane, saving: m.saving, wins, singles, lanesOver: m.rows.filter((r) => Object.values(r.cells).some((c) => c.meets === false)).length }, null, 1));
    console.log(JSON.stringify({ lap, bestSingle, byLane: m.byLane.annual, saving: m.saving, wins }, null, 1));
  }, 180_000);
});
