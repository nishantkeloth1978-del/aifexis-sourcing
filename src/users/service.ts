import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { audit, withTenant } from "@/authz";
import type { Who } from "@/events/service";
import { hashToken } from "@/suppliers/service";
import { mailConfigured } from "@/automation/mailer";
import { can } from "@/access/permissions";

export type UOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export const ORG_ROLES = ["admin", "member", "integration_admin"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[A-Za-z]{2,}$/;
const INVITE_DAYS = 14;
const bad = (error: string) => ({ ok: false as const, error });
const internal = (w: Who) => ({ kind: "internal" as const, userId: w.userId, tenantId: w.tenantId });

export interface Member { orgRoleId: string | null; roleName: string; membershipId: string; userId: string; email: string; role: string; title: string | null; department: string | null; active: boolean; joined: boolean; eventRoles: number; createdAt: string }
export interface PendingInvite { id: string; email: string; role: string; title: string | null; department: string | null; expiresAt: string; expired: boolean }

export function cleanText(v: unknown, max = 80): string | null { const s = String(v ?? "").trim().replace(/\s+/g, " "); return s ? s.slice(0, max) : null; }

async function adminOnly(who: Who): Promise<{ ok: false; error: string } | null> { return can(who, "users.manage") ? null : bad("Only an administrator can manage users."); }

export async function listMembers(pool: Pool, who: Who): Promise<UOut<{ members: Member[]; invites: PendingInvite[] }>> {
  const deny = await adminOnly(who); if (deny) return deny;
  return withTenant(pool, who.tenantId, async (c) => {
    const members = (await c.query(`select m.id, m.user_id, u.email, m.role, m.org_role_id, r.name as role_name, m.title, m.department, m.disabled_at, u.auth_user_id, m.created_at,
                                           (select count(*)::int from event_member em where em.membership_id = m.id) as event_roles
                                      from membership m join app_user u on u.id = m.user_id left join org_role r on r.id = m.org_role_id where u.email not like '%@autopilot.invalid' order by lower(u.email), m.role`)).rows
      .map((r) => ({ orgRoleId: r.org_role_id ?? null, roleName: r.role_name ?? (r.role === "admin" ? "Administrator" : r.role === "member" ? "Member" : "Integration administrator"), membershipId: r.id, userId: r.user_id, email: r.email, role: r.role, title: r.title, department: r.department, active: !r.disabled_at, joined: !!r.auth_user_id, eventRoles: r.event_roles, createdAt: new Date(r.created_at).toISOString() }));
    const invites = (await c.query(`select id, email, role, title, department, expires_at from staff_invitation where accepted_at is null and revoked_at is null order by created_at desc limit 100`)).rows
      .map((r) => ({ id: r.id, email: r.email, role: r.role, title: r.title, department: r.department, expiresAt: new Date(r.expires_at).toISOString(), expired: new Date(r.expires_at).getTime() <= Date.now() }));
    return { ok: true as const, members, invites };
  });
}

/** Creates (or replaces) a pending invitation and returns the link token ONCE. Only its hash is stored. */
export async function inviteMember(pool: Pool, who: Who, input: { email: string; role: string; title?: string; department?: string }): Promise<UOut<{ token: string; expiresAt: string; mailed: boolean }>> {
  const deny = await adminOnly(who); if (deny) return deny;
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return bad("Enter a valid e-mail address.");
  if (!ORG_ROLES.includes(input.role as OrgRole)) return bad("Choose a role.");
  return withTenant(pool, who.tenantId, async (c) => {
    const exists = (await c.query(`select 1 from membership m join app_user u on u.id = m.user_id where lower(u.email) = $1 and m.role = $2 and m.disabled_at is null`, [email, input.role])).rowCount;
    if (exists) return bad("That person already has this role.");
    await c.query(`update staff_invitation set revoked_at = now() where lower(email) = $1 and accepted_at is null and revoked_at is null`, [email]);
    const token = randomBytes(32).toString("base64url");
    const row = (await c.query(`insert into staff_invitation (tenant_id, email, role, title, department, token_hash, expires_at, created_by) values ($1,$2,$3,$4,$5,$6, now() + make_interval(days => $7), $8) returning expires_at`,
      [who.tenantId, email, input.role, cleanText(input.title), cleanText(input.department), hashToken(token), INVITE_DAYS, who.membershipId])).rows[0];
    const tenantName = (await c.query(`select name from tenant where id = $1`, [who.tenantId])).rows[0]?.name ?? "an organisation";
    const base = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
    await c.query(`insert into email_outbox (tenant_id, event_id, to_email, subject, body) values ($1,null,$2,$3,$4)`,
      [who.tenantId, email, "Aifexis: you have been invited", `You have been invited to join ${tenantName} on Aifexis as ${input.role === "admin" ? "an administrator" : "a team member"}.\n\nAccept the invitation: ${base}/join/${token}\n\nThe link works for ${INVITE_DAYS} days.`]).catch(() => undefined);
    await audit(c, internal(who), null, "users.invited", { email, role: input.role });
    return { ok: true as const, token, expiresAt: new Date(row.expires_at).toISOString(), mailed: mailConfigured() };
  });
}

export async function revokeInvite(pool: Pool, who: Who, inviteId: string): Promise<UOut> {
  const deny = await adminOnly(who); if (deny) return deny;
  if (!/^[0-9a-f-]{36}$/i.test(inviteId)) return bad("Invitation not found.");
  return withTenant(pool, who.tenantId, async (c) => {
    const r = await c.query(`update staff_invitation set revoked_at = now() where id = $1 and accepted_at is null and revoked_at is null`, [inviteId]);
    if (!r.rowCount) return bad("Invitation not found.");
    await audit(c, internal(who), null, "users.invite_revoked", {});
    return { ok: true as const };
  });
}

const adminsLeft = async (c: import("pg").PoolClient, exceptMembership: string) =>
  (await c.query(`select count(*)::int n from membership where role = 'admin' and disabled_at is null and id <> $1`, [exceptMembership])).rows[0].n as number;

export async function updateMember(pool: Pool, who: Who, membershipId: string, patch: { role?: string; title?: string | null; department?: string | null }): Promise<UOut> {
  const deny = await adminOnly(who); if (deny) return deny;
  if (!/^[0-9a-f-]{36}$/i.test(membershipId)) return bad("Person not found.");
  if (patch.role !== undefined && !ORG_ROLES.includes(patch.role as OrgRole)) return bad("Choose a role.");
  return withTenant(pool, who.tenantId, async (c) => {
    const m = (await c.query(`select id, role, user_id from membership where id = $1 for update`, [membershipId])).rows[0];
    if (!m) return bad("Person not found.");
    if (patch.role !== undefined && patch.role !== m.role) {
      if (m.role === "admin" && (await adminsLeft(c, membershipId)) < 1) return bad("The organisation needs at least one administrator.");
      const dup = (await c.query(`select 1 from membership where tenant_id = $1 and user_id = $2 and role = $3`, [who.tenantId, m.user_id, patch.role])).rowCount;
      if (dup) return bad("That person already has this role.");
    }
    await c.query(`update membership set role = coalesce($2, role), org_role_id = case when $2::text is not null and $2 <> role then null else org_role_id end, title = case when $3::boolean then $4 else title end, department = case when $5::boolean then $6 else department end where id = $1`,
      [membershipId, patch.role ?? null, patch.title !== undefined, cleanText(patch.title), patch.department !== undefined, cleanText(patch.department)]);
    await audit(c, internal(who), null, "users.updated", { membership: membershipId, role: patch.role, changedTitle: patch.title !== undefined, changedDepartment: patch.department !== undefined });
    return { ok: true as const };
  });
}

/** Switches a person off (or back on). They cannot sign in while off; their history and event roles stay for the record. */
export async function setMemberActive(pool: Pool, who: Who, membershipId: string, active: boolean): Promise<UOut<{ openEvents: number }>> {
  const deny = await adminOnly(who); if (deny) return deny;
  if (!/^[0-9a-f-]{36}$/i.test(membershipId)) return bad("Person not found.");
  return withTenant(pool, who.tenantId, async (c) => {
    const m = (await c.query(`select id, role, disabled_at from membership where id = $1 for update`, [membershipId])).rows[0];
    if (!m) return bad("Person not found.");
    if (!active) {
      if (m.id === who.membershipId) return bad("You cannot switch off your own access.");
      if (m.role === "admin" && !m.disabled_at && (await adminsLeft(c, membershipId)) < 1) return bad("The organisation needs at least one administrator.");
    }
    await c.query(`update membership set disabled_at = case when $2 then null else coalesce(disabled_at, now()) end where id = $1`, [membershipId, active]);
    const open = (await c.query(`select count(distinct em.event_id)::int n from event_member em join sourcing_event e on e.tenant_id = em.tenant_id and e.id = em.event_id
                                  where em.membership_id = $1 and e.state not in ('archived','cancelled','retendered','handed_over','awarded')`, [membershipId])).rows[0].n as number;
    await audit(c, internal(who), null, active ? "users.enabled" : "users.disabled", { membership: membershipId, openEvents: open });
    return { ok: true as const, openEvents: open };
  });
}

// ---- joining by invitation link (before anyone is signed in) ----
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
export async function staffInviteInfo(pool: Pool, token: string): Promise<{ tenantName: string; email: string; role: string; expired: boolean } | null> {
  if (!TOKEN.test(token)) return null;
  const r = (await pool.query(`select * from staff_invitation_info($1)`, [hashToken(token)])).rows[0];
  return r ? { tenantName: r.tenant_name, email: r.email, role: r.role, expired: r.expired } : null;
}
export async function acceptStaffInvite(pool: Pool, token: string, authUserId: string, email: string): Promise<boolean> {
  if (!TOKEN.test(token)) return false;
  return Boolean((await pool.query(`select * from accept_staff_invitation($1, $2, $3)`, [hashToken(token), authUserId, email])).rowCount);
}
