import { timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { withTenant } from "@/authz";
import { audit } from "@/authz/service";
import { permsFor } from "@/access/roles";
import { buildParts } from "@/handover/service";
import { mappingOf, toSapPo } from "@/handover/sap";
import { createRequest, type RequestInput } from "@/requests/service";
import type { Who } from "@/events/service";
import { hashKey } from "./service";

export interface ApiClient { tenantId: string; clientId: string; scopes: string[]; ownerMembershipId: string; prefix: string }
export interface ApiOut { status: number; body: Record<string, unknown> }
const err = (status: number, code: string, message: string): ApiOut => ({ status, body: { error: { code, message } } });

const KEY = /^aifx_([a-f0-9]{12})_([A-Za-z0-9_-]{43})$/;

/** The company and client behind a bearer key, or null. Keys are compared by hash in constant time. */
export async function authenticate(pool: Pool, header: string | null): Promise<ApiClient | null> {
  const m = /^Bearer (\S+)$/.exec(header ?? "");
  const k = m && KEY.exec(m[1]!);
  if (!k) return null;
  const row = (await pool.query(`select * from integration_lookup($1)`, [k[1]])).rows[0];
  const want = Buffer.from(row?.key_hash ?? "0".repeat(64)), got = Buffer.from(hashKey(m![1]!));
  if (!row || !row.active || want.length !== got.length || !timingSafeEqual(want, got)) return null;
  await withTenant(pool, row.tenant_id, (c) => c.query(`update integration_client set last_used_at = now() where id = $1`, [row.id]));
  return { tenantId: row.tenant_id, clientId: row.id, scopes: row.scopes, ownerMembershipId: row.owner_membership_id, prefix: k[1]! };
}

async function whoFor(pool: Pool, a: ApiClient): Promise<Who | null> {
  return withTenant(pool, a.tenantId, async (c) => {
    const m = (await c.query(`select user_id, role from membership where id = $1`, [a.ownerMembershipId])).rows[0];
    return m ? { tenantId: a.tenantId, userId: m.user_id, membershipId: a.ownerMembershipId, role: m.role, perms: await permsFor(c, a.ownerMembershipId, m.role) } : null;
  });
}

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Maps the public JSON shape to the same intake rules the screen uses. */
export function toInput(body: Record<string, unknown>): RequestInput {
  const lines = Array.isArray(body.lines) ? body.lines.slice(0, 51).map((l: Record<string, unknown>) => ({ description: str(l?.description), quantity: str(l?.quantity), unit: str(l?.unit) })) : [];
  return { kind: str(body.kind), title: str(body.title), description: str(body.description), ownerDept: str(body.department), neededBy: str(body.neededBy) || undefined, estValue: str(body.estimatedValue) || undefined, currency: str(body.currency) || undefined, lines };
}

const shape = (r: Record<string, unknown>) => ({ id: r.id, reference: r.ref, externalReference: r.external_ref ?? null, state: r.state, eventReference: r.event_ref ?? null, decisionNote: r.decision_note || undefined, createdAt: new Date(r.created_at as string).toISOString() });
const REQ_SQL = `select r.id, r.ref, r.external_ref, r.state, r.decision_note, r.created_at, e.ref as event_ref from purchase_request r left join sourcing_event e on e.tenant_id = r.tenant_id and e.id = r.event_id`;

export async function postRequest(pool: Pool, a: ApiClient, idemKey: string | null, body: unknown): Promise<ApiOut> {
  if (!a.scopes.includes("requests:write")) return err(403, "forbidden", "This key may not create requests.");
  if (!body || typeof body !== "object" || Array.isArray(body)) return err(400, "invalid_body", "Send a JSON object.");
  const b = body as Record<string, unknown>;
  const ext = str(b.externalReference).trim().slice(0, 100) || null;
  if (idemKey !== null && (idemKey.length < 1 || idemKey.length > 100)) return err(400, "invalid_idempotency_key", "Idempotency-Key must be 1 to 100 characters.");
  const who = await whoFor(pool, a);
  if (!who) return err(403, "forbidden", "The owner of this key is no longer active.");
  return withTenantOut(pool, a, async () => {
    if (idemKey) {
      const ins = await withTenant(pool, a.tenantId, (c) => c.query(`insert into integration_idempotency (tenant_id, client_id, idem_key) values ($1,$2,$3) on conflict do nothing returning 1`, [a.tenantId, a.clientId, idemKey]));
      if (!ins.rowCount) {
        const prev = await withTenant(pool, a.tenantId, async (c) => (await c.query(`select request_id from integration_idempotency where client_id = $1 and idem_key = $2`, [a.clientId, idemKey])).rows[0]?.request_id as string | null);
        if (!prev) return err(409, "in_progress", "A request with this Idempotency-Key is still being processed. Retry shortly.");
        const row = await withTenant(pool, a.tenantId, async (c) => (await c.query(`${REQ_SQL} where r.id = $1`, [prev])).rows[0]);
        return { status: 200, body: { ...shape(row), duplicate: true } };
      }
    }
    const release = () => idemKey ? withTenant(pool, a.tenantId, (c) => c.query(`delete from integration_idempotency where client_id = $1 and idem_key = $2 and request_id is null`, [a.clientId, idemKey])).catch(() => undefined) : Promise.resolve();
    if (ext) {
      const known = await withTenant(pool, a.tenantId, async (c) => (await c.query(`${REQ_SQL} where r.source = 'api' and r.external_ref = $1`, [ext])).rows[0]);
      if (known) { if (idemKey) await withTenant(pool, a.tenantId, (c) => c.query(`update integration_idempotency set request_id = $3 where client_id = $1 and idem_key = $2`, [a.clientId, idemKey, known.id])); return { status: 200, body: { ...shape(known), duplicate: true } }; }
    }
    const r = await createRequest(pool, who, toInput(b), { source: "api", externalRef: ext, skipDuplicateCheck: true });
    if (!r.ok) { await release(); return err(422, "validation_failed", r.error); }
    await withTenant(pool, a.tenantId, async (c) => {
      if (idemKey) await c.query(`update integration_idempotency set request_id = $3 where client_id = $1 and idem_key = $2`, [a.clientId, idemKey, r.request.id]);
      await audit(c, { kind: "system", tenantId: a.tenantId }, null, "integration.request_received", { client: a.prefix, ref: r.request.ref });
    });
    return { status: 201, body: { id: r.request.id, reference: r.request.ref, externalReference: ext, state: r.request.state, eventReference: null, createdAt: r.request.createdAt, duplicate: false } };
  });
}

async function withTenantOut(_pool: Pool, _a: ApiClient, fn: () => Promise<ApiOut>): Promise<ApiOut> {
  try { return await fn(); } catch (e) { console.error("[api] failed", e instanceof Error ? e.message : e); return err(500, "internal_error", "Something went wrong. Retry later."); }
}

/** One request by its Aifexis reference (REQ-2026-0001) or your own external reference. Only requests this integration source created. */
export async function getRequestApi(pool: Pool, a: ApiClient, ref: string): Promise<ApiOut> {
  if (!a.scopes.includes("requests:read")) return err(403, "forbidden", "This key may not read requests.");
  const r = await withTenant(pool, a.tenantId, async (c) => (await c.query(`${REQ_SQL} where r.source = 'api' and (r.ref = $1 or r.external_ref = $1)`, [ref.slice(0, 100)])).rows[0]);
  return r ? { status: 200, body: shape(r) } : err(404, "not_found", "No such request.");
}

/** The approved award for an event, in the stable v1 layout (one document per winning supplier). */
export async function getAwardApi(pool: Pool, a: ApiClient, eventRef: string, format?: string | null): Promise<ApiOut> {
  if (!a.scopes.includes("awards:read")) return err(403, "forbidden", "This key may not read awards.");
  return withTenantOut(pool, a, () => withTenant(pool, a.tenantId, async (c) => {
    const e = (await c.query(`select e.id, e.ref, p.ref as request_ref, p.external_ref from sourcing_event e left join purchase_request p on p.tenant_id = e.tenant_id and p.id = e.request_id where e.ref = $1`, [eventRef.slice(0, 40)])).rows[0];
    if (!e) return err(404, "not_found", "No such event.");
    const r = await buildParts(c, e.id, "SAP");
    if (!r.ok) return err(409, "not_awarded", r.error);
    if (format === "sap-po") {
      const m = await mappingOf(c);
      return { status: 200, body: { eventReference: e.ref, requestReference: e.request_ref, externalReference: e.external_ref, purchaseOrders: r.parts.map((p) => { const o = toSapPo(p.payload, m); return o.ok ? { supplier: o.supplier, purchaseOrder: o.document, warnings: o.warnings } : { supplier: o.supplier, errors: o.errors }; }) } };
    }
    return { status: 200, body: { eventReference: e.ref, requestReference: e.request_ref, externalReference: e.external_ref, awards: r.parts.map((p) => { const { target: _t, ...rest } = p.payload; void _t; return rest; }) } };
  }));
}
