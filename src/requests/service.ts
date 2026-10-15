import type { Pool, PoolClient } from "pg";
import { withTenant } from "@/authz";
import { audit } from "@/authz/service";
import { can } from "@/access/permissions";
import { permsFor } from "@/access/roles";
import { notify } from "@/notifications/hooks";
import { validateItem, type Who } from "@/events/service";

export type RequestKind = "goods" | "service";
export type RequestState = "new" | "converted" | "rejected" | "withdrawn";
export interface RequestLine { description: string; quantity: string; unit: string }
export interface RequestInput { kind: string; title: string; description?: string; ownerDept?: string; neededBy?: string; estValue?: string; currency?: string; lines?: RequestLine[] }
export interface RequestSummary { id: string; ref: string; kind: RequestKind; title: string; state: RequestState; requester: string; mine: boolean; neededBy: string | null; estValue: string | null; currency: string; source: string; createdAt: string; eventId: string | null; eventRef: string | null }
export interface RequestDetail extends RequestSummary { description: string; ownerDept: string; lines: RequestLine[]; decisionNote: string }
export type ROut<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const R_NO_PERM = "Your role cannot raise requests.";
export const R_NO_MANAGE = "Only buyers can handle requests.";
export const R_NOT_FOUND = "Request not found.";
export const R_NOT_NEW = "This request has already been handled.";
export const R_DUPLICATE = "You raised a request with this title in the last 24 hours. Open it instead of raising it again.";
export const R_NEED_NOTE = "Give a reason of at least 5 characters.";
export const R_ONLY_OWN = "Only the person who raised a request can withdraw it.";
export const REQUEST_MESSAGES = [R_NO_PERM, R_NO_MANAGE, R_NOT_FOUND, R_NOT_NEW, R_DUPLICATE, R_NEED_NOTE, R_ONLY_OWN];

const trim = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max + 1);

export function validateRequest(i: RequestInput): ROut<{ value: { kind: RequestKind; title: string; description: string; ownerDept: string; neededBy: string | null; estValue: string | null; currency: string; lines: RequestLine[] } }> {
  if (i.kind !== "goods" && i.kind !== "service") return { ok: false, error: "Choose whether this is goods or a service." };
  const title = trim(i.title, 200);
  if (title.length < 3 || title.length > 200) return { ok: false, error: "Enter a title of 3 to 200 characters." };
  const description = trim(i.description, 4000), ownerDept = trim(i.ownerDept, 100);
  if (description.length > 4000) return { ok: false, error: "The description is too long (4000 characters at most)." };
  if (ownerDept.length > 100) return { ok: false, error: "The department is too long (100 characters at most)." };
  let neededBy: string | null = null;
  if (i.neededBy) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.neededBy) || Number.isNaN(Date.parse(i.neededBy))) return { ok: false, error: "Enter the needed-by date as a valid date." };
    neededBy = i.neededBy;
  }
  let estValue: string | null = null;
  if (i.estValue && String(i.estValue).trim() !== "") {
    const v = String(i.estValue).trim();
    if (!/^\d{1,15}(\.\d{1,2})?$/.test(v)) return { ok: false, error: "The estimated value must be a number with up to 2 decimals." };
    estValue = v;
  }
  const currency = (i.currency || "AED").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "The currency must be a 3-letter code such as AED." };
  const raw = i.lines ?? [];
  if (!Array.isArray(raw) || raw.length > 50) return { ok: false, error: "A request can have up to 50 lines." };
  const lines: RequestLine[] = [];
  for (const l of raw) { const v = validateItem({ description: l.description, quantity: l.quantity, unit: l.unit }); if (!v.ok) return v; lines.push(v.value); }
  if (!lines.length && !description) return { ok: false, error: "Add at least one line or a description of what is needed." };
  return { ok: true, value: { kind: i.kind, title, description, ownerDept, neededBy, estValue, currency, lines } };
}

const SELECT = `select r.id, r.ref, r.kind, r.title, r.state, u.email as requester, (r.requester_membership_id = $1) as mine, to_char(r.needed_by, 'YYYY-MM-DD') as needed_by,
  r.est_value::text as est_value, r.currency, r.source, r.created_at, r.event_id, e.ref as event_ref, r.description, r.owner_dept, r.lines, r.decision_note
  from purchase_request r join membership m on m.tenant_id = r.tenant_id and m.id = r.requester_membership_id join app_user u on u.id = m.user_id
  left join sourcing_event e on e.tenant_id = r.tenant_id and e.id = r.event_id`;
const map = (r: Record<string, any>): RequestDetail => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  id: r.id, ref: r.ref, kind: r.kind, title: r.title, state: r.state, requester: r.requester, mine: r.mine, neededBy: r.needed_by, estValue: r.est_value, currency: r.currency, source: r.source,
  createdAt: new Date(r.created_at).toISOString(), eventId: r.event_id, eventRef: r.event_ref, description: r.description, ownerDept: r.owner_dept, lines: r.lines as RequestLine[], decisionNote: r.decision_note });

const mayRaise = (who: Who) => can(who, "request.create") || can(who, "event.create");
const mayHandle = (who: Who) => can(who, "event.create");

/** Buyers (anyone who can create events) are told about a new request; an administrator is the fallback so a request never sits unseen. */
async function buyerUsers(c: PoolClient): Promise<string[]> {
  const out: string[] = [];
  for (const m of (await c.query(`select id, user_id, role from membership where disabled_at is null`)).rows) {
    if (m.role === "admin" || (await permsFor(c, m.id, m.role)).includes("event.create")) out.push(m.user_id as string);
  }
  return [...new Set(out)];
}

export async function createRequest(pool: Pool, who: Who, input: RequestInput, opts: { source?: string; externalRef?: string | null } = {}): Promise<ROut<{ request: RequestSummary }>> {
  if (!mayRaise(who)) return { ok: false, error: R_NO_PERM };
  const v = validateRequest(input);
  if (!v.ok) return v;
  const x = v.value;
  return withTenant(pool, who.tenantId, async (c) => {
    const dup = await c.query(`select 1 from purchase_request where requester_membership_id = $1 and lower(title) = lower($2) and state = 'new' and created_at > now() - interval '24 hours'`, [who.membershipId, x.title]);
    if (dup.rowCount) return { ok: false as const, error: R_DUPLICATE };
    const year = new Date().getUTCFullYear();
    const n = (await c.query(`insert into request_counter (tenant_id, year, last) values ($1,$2,1) on conflict (tenant_id, year) do update set last = request_counter.last + 1 returning last`, [who.tenantId, year])).rows[0].last as number;
    const ref = `REQ-${year}-${String(n).padStart(4, "0")}`;
    const id = (await c.query(
      `insert into purchase_request (tenant_id, ref, source, external_ref, requester_membership_id, kind, title, description, owner_dept, needed_by, est_value, currency, lines)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [who.tenantId, ref, opts.source ?? "app", opts.externalRef ?? null, who.membershipId, x.kind, x.title, x.description, x.ownerDept, x.neededBy, x.estValue, x.currency, JSON.stringify(x.lines)])).rows[0].id as string;
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "request.created", { ref, title: x.title, source: opts.source ?? "app" });
    const to = (await buyerUsers(c)).filter((u) => u !== who.userId);
    await notify(c, who.tenantId, to, null, "request_new", `New ${x.kind === "goods" ? "goods" : "service"} request ${ref}: ${x.title}.`);
    const row = (await c.query(`${SELECT} where r.id = $2`, [who.membershipId, id])).rows[0];
    return { ok: true as const, request: map(row) };
  });
}

export async function listRequests(pool: Pool, who: Who, opts: { state?: string } = {}): Promise<RequestSummary[]> {
  if (!mayRaise(who)) return [];
  return withTenant(pool, who.tenantId, async (c) => {
    const all = mayHandle(who);
    const rows = (await c.query(
      `${SELECT} where ($2::text is null or r.state = $2) and ($3::boolean or r.requester_membership_id = $1) order by r.created_at desc limit 200`,
      [who.membershipId, opts.state && ["new", "converted", "rejected", "withdrawn"].includes(opts.state) ? opts.state : null, all])).rows;
    return rows.map(map);
  });
}

export async function getRequest(pool: Pool, who: Who, id: string): Promise<RequestDetail | null> {
  if (!mayRaise(who) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withTenant(pool, who.tenantId, async (c) => {
    const r = (await c.query(`${SELECT} where r.id = $2 and ($3::boolean or r.requester_membership_id = $1)`, [who.membershipId, id, mayHandle(who)])).rows[0];
    return r ? map(r) : null;
  });
}

async function lockNew(c: PoolClient, who: Who, id: string): Promise<ROut<{ row: Record<string, any> }>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = (await c.query(`select * from purchase_request where id = $1 for update`, [id])).rows[0];
  if (!r) return { ok: false, error: R_NOT_FOUND };
  if (!mayHandle(who) && r.requester_membership_id !== who.membershipId) return { ok: false, error: R_NOT_FOUND };
  if (r.state !== "new") return { ok: false, error: R_NOT_NEW };
  return { ok: true, row: r };
}
const actor = (who: Who) => ({ kind: "internal" as const, tenantId: who.tenantId, userId: who.userId });
const userOf = async (c: PoolClient, membershipId: string) => (await c.query(`select user_id from membership where id = $1`, [membershipId])).rows[0]?.user_id as string | undefined;

export async function withdrawRequest(pool: Pool, who: Who, id: string): Promise<ROut> {
  if (!mayRaise(who)) return { ok: false, error: R_NO_PERM };
  return withTenant(pool, who.tenantId, async (c) => {
    const l = await lockNew(c, who, id); if (!l.ok) return l;
    if (l.row.requester_membership_id !== who.membershipId) return { ok: false as const, error: R_ONLY_OWN };
    await c.query(`update purchase_request set state = 'withdrawn', decided_by = $2, updated_at = now() where id = $1`, [id, who.membershipId]);
    await audit(c, actor(who), null, "request.withdrawn", { ref: l.row.ref });
    return { ok: true as const };
  });
}

export async function rejectRequest(pool: Pool, who: Who, id: string, note: string): Promise<ROut> {
  if (!mayHandle(who)) return { ok: false, error: R_NO_MANAGE };
  const n = String(note ?? "").trim();
  if (n.length < 5 || n.length > 1000) return { ok: false, error: R_NEED_NOTE };
  return withTenant(pool, who.tenantId, async (c) => {
    const l = await lockNew(c, who, id); if (!l.ok) return l;
    await c.query(`update purchase_request set state = 'rejected', decision_note = $2, decided_by = $3, updated_at = now() where id = $1`, [id, n, who.membershipId]);
    await audit(c, actor(who), null, "request.rejected", { ref: l.row.ref });
    const u = await userOf(c, l.row.requester_membership_id);
    await notify(c, who.tenantId, [u], null, "request_rejected", `Your request ${l.row.ref} was not taken forward: ${n}`);
    return { ok: true as const };
  });
}

/** Turns a request into a draft event in one step: the requester is the event's requester, the buyer who converts it is its buyer, and the lines are copied. */
export async function convertToEvent(pool: Pool, who: Who, id: string): Promise<ROut<{ eventId: string; eventRef: string }>> {
  if (!mayHandle(who)) return { ok: false, error: R_NO_MANAGE };
  return withTenant(pool, who.tenantId, async (c) => {
    const l = await lockNew(c, who, id); if (!l.ok) return l;
    const r = l.row;
    const year = new Date().getUTCFullYear();
    const n = (await c.query(`insert into event_counter (tenant_id, year, last) values ($1,$2,1) on conflict (tenant_id, year) do update set last = event_counter.last + 1 returning last`, [who.tenantId, year])).rows[0].last as number;
    const ref = `EV-${year}-${String(n).padStart(3, "0")}`;
    const value = r.currency === "AED" && r.est_value !== null ? r.est_value : null;
    const ev = (await c.query(`insert into sourcing_event (tenant_id, title, ref, owner_dept, created_by, currency, value_aed, request_id) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [who.tenantId, r.title, ref, r.owner_dept || null, who.membershipId, r.currency, value, id])).rows[0].id as string;
    await c.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'requester')`, [who.tenantId, ev, r.requester_membership_id]);
    if (r.requester_membership_id !== who.membershipId) await c.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'buyer')`, [who.tenantId, ev, who.membershipId]);
    let no = 0;
    for (const line of r.lines as RequestLine[]) { no++; await c.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit) values ($1,$2,$3,$4,$5,$6)`, [who.tenantId, ev, no, line.description, line.quantity, line.unit]); }
    await c.query(`update purchase_request set state = 'converted', event_id = $2, decided_by = $3, updated_at = now() where id = $1`, [id, ev, who.membershipId]);
    await audit(c, actor(who), ev, "event.created_from_request", { ref, request: r.ref, lines: no });
    await audit(c, actor(who), null, "request.converted", { ref: r.ref, event: ref });
    const u = await userOf(c, r.requester_membership_id);
    await notify(c, who.tenantId, [u], ev, "request_converted", `Your request ${r.ref} became sourcing event ${ref}.`);
    return { ok: true as const, eventId: ev, eventRef: ref };
  });
}
