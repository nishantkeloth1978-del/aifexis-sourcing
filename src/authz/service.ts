import { createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import {
  BREAK_GLASS_CLASSES, DEFAULT_RULES, SUPPLIER_CLASSES, TRANSITIONS, type Rule, type RuleSet,
} from "./rules";
import {
  allow, deny, reached, BID_CLASSES, type Actor, type DataClass, type Decision, type EventRole, type EventRow,
  type Permitted, type Scope,
} from "./types";

/**
 * Central authorization service. One decision point for every read path: API, search, export,
 * notification, preview, signed URL, AI retrieval. All queries run inside withTenant, so the
 * tenant boundary is also enforced by row-level security underneath.
 */

export async function loadEvent(client: PoolClient, eventId: string): Promise<EventRow | null> {
  const { rows } = await client.query(
    `select id, tenant_id, title, state, state_version, current_version, closes_at, envelope1_opened_at,
            envelope2_opened_at, required_award_approvals, config_snapshot
       from sourcing_event where id = $1`, [eventId]);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id, tenantId: r.tenant_id, title: r.title, state: r.state, stateVersion: r.state_version,
    currentVersion: r.current_version, closesAt: r.closes_at, envelope1OpenedAt: r.envelope1_opened_at,
    envelope2OpenedAt: r.envelope2_opened_at, requiredAwardApprovals: r.required_award_approvals,
    configSnapshot: r.config_snapshot,
  };
}

export interface Subject {
  membershipIds: string[];
  /** Roles held directly. */
  ownRoles: Set<EventRole>;
  /** Roles held directly or through a delegation. */
  effectiveRoles: Set<EventRole>;
  conflictDeclared: boolean;
  membershipRoles: Set<string>;
}

export async function loadSubject(client: PoolClient, userId: string, eventId: string): Promise<Subject> {
  const m = await client.query(`select id, role from membership where user_id = $1`, [userId]);
  const membershipIds: string[] = m.rows.map((r) => r.id);
  const membershipRoles = new Set<string>(m.rows.map((r) => r.role));
  const own = new Set<EventRole>();
  const effective = new Set<EventRole>();
  let conflict = false;
  if (membershipIds.length) {
    const em = await client.query(
      `select membership_id, event_role, conflict_declared from event_member
        where event_id = $1 and membership_id = any($2::uuid[])`, [eventId, membershipIds]);
    for (const r of em.rows) { own.add(r.event_role); effective.add(r.event_role); if (r.conflict_declared) conflict = true; }
    const del = await client.query(
      `select d.from_membership_id from delegation d where d.event_id = $1 and d.to_membership_id = any($2::uuid[])`,
      [eventId, membershipIds]);
    if (del.rows.length) {
      const fromIds = del.rows.map((r) => r.from_membership_id);
      const dem = await client.query(
        `select event_role from event_member where event_id = $1 and membership_id = any($2::uuid[])`, [eventId, fromIds]);
      for (const r of dem.rows) effective.add(r.event_role);
    }
  }
  return { membershipIds, ownRoles: own, effectiveRoles: effective, conflictDeclared: conflict, membershipRoles };
}

const rank = (s: Scope): number => (s.kind === "all" ? 3 : s.kind === "qualified" ? 2 : 1);

function addPermission(out: Permitted, cls: DataClass, scope: Scope) {
  const cur = out[cls];
  if (!cur || rank(scope) > rank(cur)) out[cls] = scope;
}

function ruleApplies(rule: Rule, event: EventRow, subject: Subject): boolean {
  if (rule.from && !reached(event.state, rule.from)) return false;
  if (rule.needs === "env1" && !event.envelope1OpenedAt) return false;
  if (rule.needs === "env2" && !event.envelope2OpenedAt) return false;
  if (rule.notIfConflict && subject.conflictDeclared) return false;
  return true;
}

export type Resolved =
  | { ok: true; event: EventRow; permitted: Permitted; subject?: Subject; supplierId?: string }
  | { ok: false; reason: string };

/** Work out which classes (and which rows of them) an actor may read for one event, right now. */
export async function resolvePermitted(
  client: PoolClient, actor: Actor, eventId: string, rules: RuleSet = DEFAULT_RULES,
): Promise<Resolved> {
  const event = await loadEvent(client, eventId); // row-level security: another tenant's event is simply not there
  if (!event || event.tenantId !== actor.tenantId) return { ok: false, reason: "NOT_FOUND" };
  const permitted: Permitted = {};

  if (actor.kind === "system") return { ok: true, event, permitted };

  if (actor.kind === "internal" || actor.kind === "job") {
    const userId = actor.kind === "internal" ? actor.userId : actor.onBehalfOfUserId;
    const subject = await loadSubject(client, userId, eventId);
    for (const role of subject.effectiveRoles) {
      for (const rule of rules.eventRoles[role] ?? []) {
        if (!ruleApplies(rule, event, subject)) continue;
        if (rule.scope === "ownEvaluator") {
          // the evaluator's own scores, keyed by the member's own membership id
          const own = [...subject.membershipIds][0];
          if (own) addPermission(permitted, rule.cls, { kind: "ownEvaluator", membershipId: own });
        } else addPermission(permitted, rule.cls, { kind: rule.scope });
      }
    }
    for (const mr of subject.membershipRoles) {
      for (const rule of rules.membershipRoles[mr as keyof RuleSet["membershipRoles"]] ?? []) addPermission(permitted, rule.cls, { kind: "all" });
    }
    if (actor.kind === "job") {
      for (const cls of Object.keys(permitted) as DataClass[]) if (!actor.grants.includes(cls)) delete permitted[cls];
    }
    return { ok: true, event, permitted, subject };
  }

  if (actor.kind === "supplier") {
    const su = await client.query(`select supplier_id from supplier_user where id = $1`, [actor.supplierUserId]);
    const supplierId: string | undefined = su.rows[0]?.supplier_id;
    if (!supplierId) return { ok: false, reason: "NOT_FOUND" };
    const inv = await client.query(`select 1 from invitation where event_id = $1 and supplier_id = $2`, [eventId, supplierId]);
    if (!inv.rows.length) return { ok: false, reason: "NOT_FOUND" }; // no invitation: the event does not exist for this supplier
    if (!reached(event.state, "published")) return { ok: true, event, permitted, supplierId };
    for (const [cls, cond] of Object.entries(SUPPLIER_CLASSES) as [DataClass, { from?: Rule["from"] }][]) {
      if (cond.from && !reached(event.state, cond.from)) continue;
      permitted[cls] = cls === "D5" ? { kind: "sharedPlusOwn", supplierId } : { kind: "ownSupplier", supplierId };
    }
    if (!permitted.D2) permitted.D2 = { kind: "all" };
    return { ok: true, event, permitted, supplierId };
  }

  // operator: nothing without a valid, unexpired grant for this event; every use is audited
  if (!actor.breakGlassGrantId) return { ok: true, event, permitted };
  const g = await client.query(
    `select 1 from break_glass_grant where id = $1 and operator_id = $2 and event_id = $3 and expires_at > now()`,
    [actor.breakGlassGrantId, actor.operatorId, eventId]);
  if (!g.rows.length) return { ok: true, event, permitted };
  for (const cls of BREAK_GLASS_CLASSES) permitted[cls] = { kind: "all" };
  await audit(client, actor, eventId, "break_glass.access", { grant: actor.breakGlassGrantId });
  return { ok: true, event, permitted };
}

export function actorLabel(actor: Actor): string {
  switch (actor.kind) {
    case "internal": return `internal:${actor.userId}`;
    case "supplier": return `supplier:${actor.supplierUserId}`;
    case "job": return `job:${actor.jobId}:for:${actor.onBehalfOfUserId}`;
    case "operator": return `operator:${actor.operatorId}`;
    default: return "system";
  }
}

export async function audit(client: PoolClient, actor: Actor, eventId: string | null, action: string, detail: unknown = {}) {
  await client.query(
    `insert into audit_event (tenant_id, event_id, actor, action, detail) values ($1, $2, $3, $4, $5)`,
    [actor.tenantId, eventId, actorLabel(actor), action, JSON.stringify(detail)]);
}

/** May this actor read this class of this event? Cross-tenant and unknown events are indistinguishable (NOT_FOUND). */
export async function decideRead(
  client: PoolClient, actor: Actor, eventId: string, cls: DataClass, rules: RuleSet = DEFAULT_RULES,
): Promise<Decision> {
  const r = await resolvePermitted(client, actor, eventId, rules);
  if (!r.ok) return deny(r.reason);
  const scope = r.permitted[cls];
  if (!scope) return deny(BID_CLASSES.includes(cls) ? "ENVELOPE_SEALED" : "FORBIDDEN");
  return allow("OK", scope);
}

export interface TransitionPayload {
  witnessMembershipId?: string;
  approvedByMembershipId?: string;
  qualifiedSupplierIds?: string[];
  idempotencyKey?: string;
}

/** Can this actor run this command now? Checks state, version, role, separation of duties, witness and approval needs. */
export async function checkTransition(
  client: PoolClient, actor: Actor, eventId: string, command: string, expectedVersion?: number, payload: TransitionPayload = {},
): Promise<Decision> {
  const def = TRANSITIONS[command];
  if (!def) return deny("UNKNOWN_COMMAND");
  const event = await loadEvent(client, eventId);
  if (!event || event.tenantId !== actor.tenantId) return deny("NOT_FOUND");
  if (expectedVersion !== undefined && event.stateVersion !== expectedVersion) return deny("STALE_VERSION");
  if (!def.from.includes(event.state)) return deny("BAD_STATE");

  if (actor.kind === "system") {
    if (!def.allowSystem) return deny("FORBIDDEN_ROLE");
    if (command === "CloseEvent" && !(event.closesAt && event.closesAt.getTime() <= Date.now())) return deny("DEADLINE_NOT_REACHED");
    return allow();
  }
  if (actor.kind !== "internal") return deny("FORBIDDEN_ROLE");

  const subject = await loadSubject(client, actor.userId, eventId);
  if (!def.roles.some((r) => subject.effectiveRoles.has(r))) return deny("FORBIDDEN_ROLE");
  // Separation of duties applies to the person acting, including when acting by delegation.
  if (def.forbiddenOwnRoles?.some((r) => subject.ownRoles.has(r))) return deny("SOD_VIOLATION");
  if (def.needsWitness) {
    const w = payload.witnessMembershipId;
    if (!w) return deny("WITNESS_REQUIRED");
    const ok = await client.query(
      `select 1 from event_member where event_id = $1 and membership_id = $2 and event_role = 'witness'`, [eventId, w]);
    if (!ok.rows.length) return deny("WITNESS_REQUIRED");
  }
  if (def.needsPmApproval) {
    const a = payload.approvedByMembershipId;
    if (!a) return deny("APPROVAL_REQUIRED");
    const ok = await client.query(
      `select 1 from event_member where event_id = $1 and membership_id = $2 and event_role = 'award_approver'`, [eventId, a]);
    if (!ok.rows.length) return deny("APPROVAL_REQUIRED");
  }
  return allow();
}

// ------------------------------------------------------------------ signed document URLs

const signingSecret = () => process.env.SIGNING_SECRET ?? "dev-only-secret";

function sign(objectId: string, exp: number): string {
  return createHmac("sha256", signingSecret()).update(`${objectId}.${exp}`).digest("hex");
}

export function verifySignedUrl(url: string, now = Date.now()): { ok: boolean; objectId?: string } {
  const u = new URL(url, "https://files.invalid");
  const objectId = u.pathname.split("/").pop() ?? "";
  const exp = Number(u.searchParams.get("exp"));
  const sig = u.searchParams.get("sig") ?? "";
  const good = sign(objectId, exp);
  if (!exp || exp * 1000 < now || sig.length !== good.length) return { ok: false };
  return timingSafeEqual(Buffer.from(sig), Buffer.from(good)) ? { ok: true, objectId } : { ok: false };
}

/**
 * Short-lived URL for a stored document, issued only after an authorization check.
 * Unknown, other-tenant and not-permitted objects all return the same NOT_FOUND, so existence does not leak.
 */
export async function signedUrl(
  client: PoolClient, actor: Actor, objectId: string, ttlSeconds = 60, rules: RuleSet = DEFAULT_RULES,
): Promise<{ allow: boolean; reason: string; url?: string }> {
  const o = await client.query(`select event_id, supplier_id, data_class from stored_object where id = $1`, [objectId]);
  const row = o.rows[0];
  if (!row) return { allow: false, reason: "NOT_FOUND" };
  const r = await resolvePermitted(client, actor, row.event_id, rules);
  if (!r.ok) return { allow: false, reason: "NOT_FOUND" };
  const scope = r.permitted[row.data_class as DataClass];
  let ok = !!scope;
  if (scope?.kind === "ownSupplier" && scope.supplierId !== row.supplier_id) ok = false;
  if (scope?.kind === "qualified") {
    const q = await client.query(
      `select 1 from qualified_bidder where event_id = $1 and supplier_id = $2 and superseded_at is null`, [row.event_id, row.supplier_id]);
    ok = q.rows.length > 0;
  }
  if (!ok) return { allow: false, reason: "NOT_FOUND" };
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { allow: true, reason: "OK", url: `/files/${objectId}?exp=${exp}&sig=${sign(objectId, exp)}` };
}
