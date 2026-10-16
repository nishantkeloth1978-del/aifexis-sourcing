import type { Pool, PoolClient } from "pg";
import { applyTransition, audit, withTenant } from "@/authz";
import { failedKnockouts, policyFor, resolveConfig } from "@/config/service";
import { permsFor } from "@/access/roles";
import { policyOf } from "./policy";
import { AUTOPILOT_SEATS, autopilotEmail, type AutopilotInfo, type AutopilotSeat } from "./autopilot-types";
import type { Policy } from "./policy-types";
import type { AiDeps } from "@/messages/ai";
import type { Who } from "@/events/service";
import { approvePublication, submitForPublication } from "@/events/workflow";
import { convertTx, buyerUsers, type RequestLine } from "@/requests/service";
import { inviteSupplier } from "@/suppliers/service";
import { decide, requestDecision } from "@/decisions/service";
import { openTechnicalEnvelopes } from "@/evaluation/service";
import { approveAwardNow, getCommercialView, openCommercialEnvelopes, recordRecommendation, submitForAward } from "@/commercial/service";
import { runBidCheck } from "@/bids/bidcheck";
import { notify } from "@/notifications/hooks";

export type Seats = Record<AutopilotSeat, Who>;
const SYSTEM = (tenantId: string) => ({ kind: "system" as const, tenantId });

/** The three Autopilot identities of a company, created on first use. */
export async function castOf(pool: Pool, tenantId: string): Promise<Seats> {
  return withTenant(pool, tenantId, async (c) => {
    const out: Partial<Seats> = {};
    for (const seat of AUTOPILOT_SEATS) {
      const email = autopilotEmail(tenantId, seat);
      let userId = (await c.query(`select id from app_user where email = $1`, [email])).rows[0]?.id as string | undefined;
      if (!userId) userId = (await c.query(`insert into app_user (email) values ($1) on conflict (email) do update set email = excluded.email returning id`, [email])).rows[0].id as string;
      let membershipId = (await c.query(`select id from membership where tenant_id = $1 and user_id = $2 and role = 'member'`, [tenantId, userId])).rows[0]?.id as string | undefined;
      if (!membershipId) membershipId = (await c.query(`insert into membership (tenant_id, user_id, role) values ($1,$2,'member') on conflict (tenant_id, user_id, role) do update set role = excluded.role returning id`, [tenantId, userId])).rows[0].id as string;
      out[seat] = { tenantId, userId, membershipId, role: "member", perms: [...(await permsFor(c, membershipId, "member"))] };
    }
    return out as Seats;
  });
}

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const active = (p: Policy) => p.level === 3 && !p.paused;

async function tell(c: PoolClient, tenantId: string, eventId: string | null, message: string) {
  await notify(c, tenantId, await buyerUsers(c), eventId, "autopilot", message);
}

/** Stops Autopilot on an event for a person to take over. Said once: a held event is left alone until a person acts. */
export async function holdEvent(pool: Pool, tenantId: string, eventId: string, reason: string): Promise<void> {
  await withTenant(pool, tenantId, async (c) => {
    const r = await c.query(`update sourcing_event set autopilot_hold = $2 where id = $1 and autopilot and autopilot_hold is null returning ref`, [eventId, reason.slice(0, 500)]);
    if (!r.rowCount) return;
    await audit(c, SYSTEM(tenantId), eventId, "autopilot.held", { reason });
    await tell(c, tenantId, eventId, `Autopilot stopped on ${r.rows[0].ref}: ${reason} An administrator can take the event over from its page.`);
  });
}

export interface RequestRow { id: string; ref: string; title: string; est_value: string | null; currency: string; lines: (RequestLine & { materialGroup?: string })[] }

/** Whether Autopilot may take this request, and which approved suppliers it would invite. A reason means a person handles it. */
export async function checkRequest(c: PoolClient, p: Policy, r: RequestRow): Promise<{ ok: true; suppliers: string[]; groups: string[] } | { ok: false; reason: string }> {
  if (r.currency !== "AED" || r.est_value === null) return { ok: false, reason: "the request has no estimated value in AED." };
  const value = Number(r.est_value);
  if (!(p.autopilotMaxValue > 0) || value > p.autopilotMaxValue) return { ok: false, reason: `the estimated value (AED ${money(value)}) is above the Autopilot limit (AED ${money(p.autopilotMaxValue)}).` };
  if (!r.lines?.length) return { ok: false, reason: "the request has no lines to price." };
  const cfg = await resolveConfig(c);
  if (policyFor(cfg, value).awardApprovals > 1) return { ok: false, reason: "at this value your approval policy needs more than one award approver." };
  const groups = [...new Set(r.lines.map((l) => String(l.materialGroup ?? "").trim().toLowerCase()).filter(Boolean))];
  if (!groups.length) return { ok: false, reason: "the request lines carry no material group, so approved suppliers cannot be matched." };
  const suppliers = (await c.query(
    `select s.id from supplier_org s where coalesce(s.status, 'active') = 'active' and lower(trim(coalesce(s.category, ''))) = any($1::text[]) and exists (select 1 from supplier_user su where su.supplier_id = s.id) order by s.name`, [groups])).rows.map((x) => x.id as string);
  if (suppliers.length < p.autopilotMinSuppliers) return { ok: false, reason: `only ${suppliers.length} active supplier(s) match the material group (${groups.join(", ")}); at least ${p.autopilotMinSuppliers} are needed.` };
  return { ok: true, suppliers, groups };
}

const inviteLink = (token: string) => {
  const base = process.env.NEXT_PUBLIC_SUPPLIER_URL || process.env.SUPPLIER_APP_URL || process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return base ? `${base.replace(/\/$/, "")}/invite/${token}` : "";
};

export type AutopilotResult = "started" | "skipped" | "held";

/**
 * Level 3: takes one new request all the way to a published event with invited suppliers, with no person involved.
 * Does nothing (and says why on the request) when the request is not eligible; a buyer then handles it as usual.
 */
export async function autopilotRequest(pool: Pool, tenantId: string, requestId: string): Promise<AutopilotResult> {
  const p = await withTenant(pool, tenantId, (c) => policyOf(c));
  if (!active(p)) return "skipped";
  const cast = await castOf(pool, tenantId);
  const made = await withTenant(pool, tenantId, async (c) => {
    const r = (await c.query(`select id, ref, title, est_value::text as est_value, currency, lines from purchase_request where id = $1 and state = 'new' and autopilot_skip is null for update`, [requestId])).rows[0] as RequestRow | undefined;
    if (!r) return null;
    const chk = await checkRequest(c, p, r);
    if (!chk.ok) {
      await c.query(`update purchase_request set autopilot_skip = $2 where id = $1`, [r.id, chk.reason.slice(0, 500)]);
      await audit(c, SYSTEM(tenantId), null, "autopilot.skipped", { request: r.ref, reason: chk.reason });
      await tell(c, tenantId, null, `Autopilot left ${r.ref} to a person: ${chk.reason}`);
      return "skipped" as const;
    }
    const conv = await convertTx(c, cast.buyer, r.id);
    if (!conv.ok) return "skipped" as const;
    await c.query(`update sourcing_event set autopilot = true, closes_at = now() + ($2 || ' days')::interval where id = $1`, [conv.eventId, String(p.autopilotBidDays)]);
    for (const role of ["publication_approver", "tech_approver", "award_approver"]) await c.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,$4) on conflict do nothing`, [tenantId, conv.eventId, cast.approver.membershipId, role]);
    await c.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'witness') on conflict do nothing`, [tenantId, conv.eventId, cast.witness.membershipId]);
    await audit(c, SYSTEM(tenantId), conv.eventId, "autopilot.started", { request: r.ref, suppliers: chk.suppliers.length, groups: chk.groups, limit: p.autopilotMaxValue });
    return { eventId: conv.eventId, eventRef: conv.eventRef, suppliers: chk.suppliers };
  });
  if (made === null || made === "skipped") return "skipped";

  const { eventId } = made;
  const version = async () => (await withTenant(pool, tenantId, async (c) => (await c.query(`select state::text as state, state_version from sourcing_event where id = $1`, [eventId])).rows[0])) as { state: string; state_version: number };
  const fail = async (why: string): Promise<AutopilotResult> => { await holdEvent(pool, tenantId, eventId, why); return "held"; };
  let v = await version();
  const sub = await submitForPublication(pool, cast.buyer, eventId, v.state_version);
  if (!sub.ok) return fail(sub.error);
  v = await version();
  if (v.state === "pending_publication") { const ap = await approvePublication(pool, cast.approver, eventId, v.state_version); if (!ap.ok) return fail(ap.error); }
  let invited = 0;
  for (const sid of made.suppliers) {
    const inv = await inviteSupplier(pool, cast.buyer, eventId, sid);
    if (!inv.ok) continue;
    invited++;
    await withTenant(pool, tenantId, async (c) => {
      const to = (await c.query(`select u.email from supplier_user su join app_user u on u.id = su.user_id where su.supplier_id = $1 order by su.id limit 1`, [sid])).rows[0]?.email as string | undefined;
      const link = inviteLink(inv.token);
      if (to && link) await c.query(`insert into email_outbox (tenant_id, event_id, to_email, subject, body) values ($1,$2,$3,$4,$5)`, [tenantId, eventId, to, `Aifexis: you are invited to bid on ${made.eventRef}`, `You are invited to bid on ${made.eventRef}. Open this link to sign in and see the details:\n${link}\n\nThe link is personal to you; do not forward it.`]);
    });
  }
  if (invited < p.autopilotMinSuppliers) return fail(`only ${invited} supplier(s) could be invited; at least ${p.autopilotMinSuppliers} are needed.`);
  await withTenant(pool, tenantId, async (c) => { await audit(c, SYSTEM(tenantId), eventId, "autopilot.published", { invited }); });
  return "started";
}

async function stateOf(pool: Pool, tenantId: string, eventId: string) {
  return withTenant(pool, tenantId, async (c) => (await c.query(`select ref, state::text as state, state_version, autopilot, autopilot_hold, title from sourcing_event where id = $1`, [eventId])).rows[0]) as Promise<{ ref: string; state: string; state_version: number; autopilot: boolean; autopilot_hold: string | null; title: string } | undefined>;
}
const STALE = /changed while you were looking|not in the right state/i;

/** The step after closing, done as the Autopilot buyer and witness: the witness confirms on the buyer's request, then the envelope opens. */
async function openEnvelope(pool: Pool, cast: Seats, eventId: string, version: number, command: "OpenEnvelope1" | "OpenEnvelope2") {
  const rq = await requestDecision(pool, cast.buyer, eventId, version, command, { witnessMembershipId: cast.witness.membershipId });
  if (!rq.ok) return rq;
  const d = await decide(pool, cast.witness, rq.requestId, true);
  if (!d.ok) return d;
  return command === "OpenEnvelope1" ? openTechnicalEnvelopes(pool, cast.buyer, eventId, version, cast.witness.membershipId) : openCommercialEnvelopes(pool, cast.buyer, eventId, version, cast.witness.membershipId);
}

/**
 * Moves one Autopilot event as far as it can go: open envelopes, qualify bidders on pass/fail gates, rank, recommend, and approve the award.
 * Stops (holds) for a person when there are too few bids, a bid check flag, a close result, missing assumptions or lots. Returns the last state reached.
 */
export async function advanceEvent(pool: Pool, tenantId: string, eventId: string, deps: AiDeps = {}): Promise<string> {
  const cast = await castOf(pool, tenantId);
  for (let i = 0; i < 12; i++) {
    const p = await withTenant(pool, tenantId, (c) => policyOf(c));
    const e = await stateOf(pool, tenantId, eventId);
    if (!e || !e.autopilot || e.autopilot_hold || !active(p)) return e?.state ?? "none";
    const hold = async (why: string) => { await holdEvent(pool, tenantId, eventId, why); return "held"; };
    const bad = async (r: { ok: false; error: string }) => (STALE.test(r.error) ? e.state : hold(`${r.error}`));
    const V = e.state_version;
    if (e.state === "closed") {
      const n = (await withTenant(pool, tenantId, async (c) => (await c.query(`select count(distinct supplier_id)::int n from bid_revision where event_id = $1`, [eventId])).rows[0].n)) as number;
      if (n < p.autopilotMinBids) return hold(`only ${n} bid(s) were received; at least ${p.autopilotMinBids} are needed.`);
      const r = await openEnvelope(pool, cast, eventId, V, "OpenEnvelope1"); if (!r.ok) return bad(r);
    } else if (e.state === "technical_evaluation") {
      const q = await withTenant(pool, tenantId, async (c) => {
        const cfg = await resolveConfig(c, eventId);
        const bidders = (await c.query(`select distinct supplier_id from bid_revision where event_id = $1`, [eventId])).rows.map((x) => x.supplier_id as string);
        const gates = new Map((await c.query(`select br.supplier_id, bi.payload->'gates' as gates from bid_item bi join bid_revision br on br.tenant_id = bi.tenant_id and br.id = bi.bid_revision_id
          where br.event_id = $1 and bi.kind like 'technical%' and bi.data_class = 'D6' and br.revision_no = (select max(x.revision_no) from bid_revision x where x.tenant_id = br.tenant_id and x.event_id = br.event_id and x.supplier_id = br.supplier_id)`, [eventId])).rows.map((x) => [x.supplier_id as string, x.gates as { name: string; answer: boolean }[] | undefined]));
        const qualified = bidders.filter((s) => !failedKnockouts(cfg, gates.get(s)).length);
        return { bidders, qualified };
      });
      if (q.qualified.length < p.autopilotMinBids) return hold(`only ${q.qualified.length} bidder(s) passed the mandatory gates; at least ${p.autopilotMinBids} are needed.`);
      const ok = await withTenant(pool, tenantId, async (c) => {
        const res = await applyTransition(c, { kind: "internal", userId: cast.approver.userId, tenantId }, eventId, "ApproveTechnicalResult", { expectedVersion: V, payload: { qualifiedSupplierIds: q.qualified, idempotencyKey: `technical:${eventId}:${V}` } });
        if (!res.ok) return { ok: false as const, error: `Technical approval was refused (${res.decision.reason}).` };
        for (const s of q.bidders) await c.query(`insert into tech_result (tenant_id, event_id, supplier_id, total, qualified) values ($1,$2,$3,0,$4)`, [tenantId, eventId, s, q.qualified.includes(s)]);
        await audit(c, SYSTEM(tenantId), eventId, "autopilot.qualified", { qualified: q.qualified.length, bidders: q.bidders.length, basis: "mandatory gates only; no technical scores" });
        return { ok: true as const };
      });
      if (!ok.ok) return bad(ok);
    } else if (e.state === "technical_approved") {
      const r = await openEnvelope(pool, cast, eventId, V, "OpenEnvelope2"); if (!r.ok) return bad(r);
    } else if (e.state === "commercial_evaluation") {
      const chk = await runBidCheck(pool, cast.buyer, eventId, deps);
      if (!chk.ok) return hold(`the bid check could not run (${chk.error})`);
      const flagged = (await withTenant(pool, tenantId, async (c) => (await c.query(
        `select count(*)::int n from bid_check where event_id = $1 and state = 'open' and severity in ('warn','block') and supplier_id in (select supplier_id from qualified_bidder where event_id = $1 and superseded_at is null)`, [eventId])).rows[0].n)) as number;
      if (flagged) return hold(`the bid check raised ${flagged} finding(s) on qualified bids that a person should look at.`);
      const view = await getCommercialView(pool, cast.buyer, eventId);
      const cmp = view?.comparison;
      if (!cmp) return hold("there is no commercial comparison to rank from.");
      if (cmp.lots) return hold("the event has lots; Autopilot does not split awards.");
      if (cmp.missing?.length) return hold("evaluation assumptions are missing for some bidders.");
      if (cmp.rows.length < p.autopilotMinBids) return hold(`only ${cmp.rows.length} qualified priced bid(s); at least ${p.autopilotMinBids} are needed.`);
      if (cmp.closeResult) return hold("the top bids are too close to call automatically.");
      const top = cmp.rows[0]!;
      const note = `Selected automatically by Autopilot: ${top.name} ranks first with a score of ${top.final} and a total of ${top.total} ${cmp.currency}, among ${cmp.rows.length} qualified bids.`;
      const r = await recordRecommendation(pool, cast.buyer, eventId, V, top.supplierId, note); if (!r.ok) return bad(r);
    } else if (e.state === "recommended") {
      const r = await submitForAward(pool, cast.buyer, eventId, V); if (!r.ok) return bad(r);
    } else if (e.state === "pending_award") {
      const r = await approveAwardNow(pool, cast.approver, eventId, V); if (!r.ok) return bad(r);
      await withTenant(pool, tenantId, async (c) => {
        await audit(c, SYSTEM(tenantId), eventId, "autopilot.awarded", { limit: p.autopilotMaxValue });
        await tell(c, tenantId, eventId, `Autopilot awarded ${e.ref} (${e.title}) with no person approving. Review the result under Awards.`);
      });
    } else return e.state;
  }
  return (await stateOf(pool, tenantId, eventId))?.state ?? "none";
}

/** Backup and the later steps, run by the automatic run: requests Autopilot has not taken yet, then every Autopilot event waiting for its next step. */
export async function autopilotSweep(pool: Pool, tenantId: string, deps: AiDeps = {}): Promise<{ requests: number; events: number }> {
  const p = await withTenant(pool, tenantId, (c) => policyOf(c));
  if (!active(p)) return { requests: 0, events: 0 };
  const reqs = await withTenant(pool, tenantId, async (c) => (await c.query(`select id from purchase_request where state = 'new' and autopilot_skip is null and created_at < now() - interval '3 minutes' and created_at > now() - interval '3 days' order by created_at limit 5`)).rows.map((r) => r.id as string));
  let nr = 0;
  for (const id of reqs) { try { if ((await autopilotRequest(pool, tenantId, id)) !== "skipped") nr++; } catch (e) { console.error("autopilot request failed", e instanceof Error ? e.message : e); } }
  const evs = await withTenant(pool, tenantId, async (c) => (await c.query(`select id from sourcing_event where autopilot and autopilot_hold is null and state in ('closed','technical_evaluation','technical_approved','commercial_evaluation','recommended','pending_award') order by created_at limit 10`)).rows.map((r) => r.id as string));
  let ne = 0;
  for (const id of evs) { try { await advanceEvent(pool, tenantId, id, deps); ne++; } catch (e) { console.error("autopilot step failed", e instanceof Error ? e.message : e); } }
  return { requests: nr, events: ne };
}

/** What the event page shows: whether Autopilot runs the event, why it stopped, and whether this person can take it over. */
export async function getAutopilotInfo(pool: Pool, who: Who, eventId: string): Promise<AutopilotInfo | null> {
  return withTenant(pool, who.tenantId, async (c) => {
    const e = (await c.query(`select autopilot, autopilot_hold, state::text as state from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!e || !e.autopilot) return null;
    return { autopilot: true, hold: e.autopilot_hold ?? null, state: e.state, canTakeOver: who.role === "admin" || (who.perms ?? []).includes("config.manage") };
  });
}

/** An administrator takes an Autopilot event over: the chosen people replace the three Autopilot identities and Autopilot never touches the event again. */
export async function takeOverEvent(pool: Pool, who: Who, eventId: string, people: { buyer: string; witness: string; techApprover: string; awardApprover: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(who.role === "admin" || (who.perms ?? []).includes("config.manage"))) return { ok: false, error: "Only an administrator can take an event over from Autopilot." };
  const ids = Object.values(people);
  if (ids.some((x) => !/^[0-9a-f-]{36}$/i.test(String(x)))) return { ok: false, error: "Choose a person for every role." };
  try {
    return await withTenant(pool, who.tenantId, async (c) => {
      const e = (await c.query(`select ref, autopilot from sourcing_event where id = $1 for update`, [eventId])).rows[0];
      if (!e) return { ok: false as const, error: "Event not found." };
      if (!e.autopilot) return { ok: false as const, error: "This event is not run by Autopilot." };
      const real = (await c.query(`select m.id from membership m join app_user u on u.id = m.user_id where m.id = any($1::uuid[]) and m.disabled_at is null and m.role in ('admin','member') and u.email not like '%@autopilot.invalid'`, [ids])).rows.length;
      if (real !== new Set(ids).size) return { ok: false as const, error: "Choose active people from your organisation." };
      await c.query(`savepoint tk`);
      await c.query(`delete from event_member where event_id = $1 and membership_id in (select m.id from membership m join app_user u on u.id = m.user_id where u.email like '%@autopilot.invalid')`, [eventId]);
      try {
        const add = (m: string, role: string) => c.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,$4) on conflict do nothing`, [who.tenantId, eventId, m, role]);
        await add(people.buyer, "buyer"); await add(people.witness, "witness");
        for (const r of ["publication_approver", "tech_approver"]) await add(people.techApprover, r);
        await add(people.awardApprover, "award_approver");
      } catch (err) {
        await c.query(`rollback to savepoint tk`);
        if (/separation of duties/i.test((err as Error).message)) return { ok: false as const, error: "Those roles conflict (separation of duties): the buyer cannot also approve. Choose different people." };
        throw err;
      }
      await c.query(`update sourcing_event set autopilot = false, autopilot_hold = null where id = $1`, [eventId]);
      await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "autopilot.taken_over", { people });
      return { ok: true as const };
    });
  } catch { return { ok: false, error: "That could not be saved. Try again." }; }
}
