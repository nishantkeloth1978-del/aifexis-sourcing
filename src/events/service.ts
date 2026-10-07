import type { Pool } from "pg";
import { audit, withTenant } from "@/authz";

export interface Who { tenantId: string; userId: string; membershipId: string; role: string }

export interface EventSummary {
  id: string; ref: string; title: string; ownerDept: string; state: string;
  valueAed: string | null; closesAt: string | null; currency: string; createdAt: string;
}

export interface CreateInput { title: string; ownerDept?: string; closesAt?: string }
export type CreateResult = { ok: true; event: EventSummary } | { ok: false; error: string };

const CAN_CREATE = new Set(["admin", "member"]);

export function validate(input: CreateInput): { ok: true; value: { title: string; ownerDept: string; closesAt: string | null } } | { ok: false; error: string } {
  const title = (input.title ?? "").trim();
  if (title.length < 3) return { ok: false, error: "Enter a title of at least 3 characters." };
  if (title.length > 200) return { ok: false, error: "The title is too long (200 characters at most)." };
  const ownerDept = (input.ownerDept ?? "").trim().slice(0, 100);
  let closesAt: string | null = null;
  if (input.closesAt) {
    const d = new Date(input.closesAt);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "The closing date is not valid." };
    closesAt = d.toISOString();
  }
  return { ok: true, value: { title, ownerDept, closesAt } };
}

const SELECT = `select id, ref, title, coalesce(owner_dept, '') as owner_dept, state::text as state, value_aed::text as value_aed,
                       closes_at, currency, created_at from sourcing_event`;

const map = (r: Record<string, unknown>): EventSummary => ({
  id: r.id as string, ref: r.ref as string, title: r.title as string, ownerDept: r.owner_dept as string, state: r.state as string,
  valueAed: (r.value_aed as string | null) ?? null, closesAt: r.closes_at ? new Date(r.closes_at as string).toISOString() : null,
  currency: r.currency as string, createdAt: new Date(r.created_at as string).toISOString(),
});

export async function listEvents(pool: Pool, who: Who): Promise<EventSummary[]> {
  return withTenant(pool, who.tenantId, async (c) => (await c.query(`${SELECT} order by created_at desc, ref desc limit 200`)).rows.map(map));
}

export async function createEvent(pool: Pool, who: Who, input: CreateInput): Promise<CreateResult> {
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot create events." };
  const v = validate(input);
  if (!v.ok) return v;
  return withTenant(pool, who.tenantId, async (c) => {
    const year = new Date().getUTCFullYear();
    const n = (await c.query(
      `insert into event_counter (tenant_id, year, last) values ($1, $2, 1)
       on conflict (tenant_id, year) do update set last = event_counter.last + 1 returning last`, [who.tenantId, year])).rows[0].last as number;
    const ref = `EV-${year}-${String(n).padStart(3, "0")}`;
    const row = (await c.query(
      `insert into sourcing_event (tenant_id, title, ref, owner_dept, closes_at, created_by)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [who.tenantId, v.value.title, ref, v.value.ownerDept || null, v.value.closesAt, who.membershipId])).rows[0];
    await c.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1, $2, $3, 'requester')`,
      [who.tenantId, row.id, who.membershipId]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, row.id, "event.created", { ref, title: v.value.title });
    const out = (await c.query(`${SELECT} where id = $1`, [row.id])).rows[0];
    return { ok: true as const, event: map(out) };
  });
}
