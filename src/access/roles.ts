import type { Pool, PoolClient } from "pg";
import { audit, withTenant } from "@/authz";
import type { Who } from "@/events/service";
import { ALL_PERMS, DEFAULT_PERMS, allowedForRole, can } from "./permissions";

export type ROut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const bad = (error: string) => ({ ok: false as const, error });
const internal = (w: Who) => ({ kind: "internal" as const, userId: w.userId, tenantId: w.tenantId });
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} '&()./,-]{1,59}$/u;

export interface RoleInfo { id: string | null; key: string; name: string; description: string | null; baseRole: string; builtin: boolean; fixed: boolean; perms: string[]; members: number; version: number }

async function permsOfRoleId(c: PoolClient, roleId: string): Promise<string[]> {
  return (await c.query(`select permission from org_role_permission where role_id = $1 order by permission`, [roleId])).rows.map((r) => r.permission as string);
}

/** The permissions of one membership, resolved from its custom role, else its organisation's built-in role, else the defaults. */
export async function permsFor(c: PoolClient, membershipId: string, role: string): Promise<string[]> {
  if (role === "admin") return [...ALL_PERMS];
  const m = (await c.query(`select org_role_id from membership where id = $1`, [membershipId])).rows[0];
  if (m?.org_role_id) return allowedForRole(await permsOfRoleId(c, m.org_role_id));
  const b = (await c.query(`select id from org_role where system_key = $1`, [role])).rows[0];
  return b ? allowedForRole(await permsOfRoleId(c, b.id)) : [...(DEFAULT_PERMS[role] ?? [])];
}
export const loadPerms = (pool: Pool, tenantId: string, membershipId: string, role: string) => withTenant(pool, tenantId, (c) => permsFor(c, membershipId, role));

export async function listRoles(pool: Pool, who: Who): Promise<ROut<{ roles: RoleInfo[] }>> {
  if (!can(who, "roles.manage")) return bad("Only an administrator can manage roles.");
  return withTenant(pool, who.tenantId, async (c) => {
    const rows = (await c.query(`select r.id, r.name, r.description, r.base_role, r.system_key, r.version,
        coalesce((select array_agg(p.permission order by p.permission) from org_role_permission p where p.role_id = r.id), '{}') as perms,
        (select count(*)::int from membership m where m.org_role_id = r.id) as custom_members
        from org_role r order by r.created_at, r.name`)).rows;
    const counts = Object.fromEntries((await c.query(`select role, count(*)::int n from membership where org_role_id is null and disabled_at is null group by role`)).rows.map((r) => [r.role, r.n]));
    const out: RoleInfo[] = [{ id: null, key: "admin", name: "Administrator", description: "Everything in the organisation. Cannot be changed.", baseRole: "admin", builtin: true, fixed: true, perms: [...ALL_PERMS], members: counts.admin ?? 0, version: 0 }];
    for (const key of ["member", "integration_admin"] as const) {
      const r = rows.find((x) => x.system_key === key);
      out.push({ id: (r?.id as string | undefined) ?? null, key, name: key === "member" ? "Member" : "Integration administrator", description: r?.description ?? null, baseRole: key, builtin: true, fixed: false,
        perms: r ? allowedForRole(r.perms) : [...DEFAULT_PERMS[key]!], members: counts[key] ?? 0, version: r?.version ?? 0 });
    }
    for (const r of rows.filter((x) => !x.system_key)) out.push({ id: r.id, key: r.id, name: r.name, description: r.description, baseRole: r.base_role, builtin: false, fixed: false, perms: allowedForRole(r.perms), members: r.custom_members, version: r.version });
    return { ok: true as const, roles: out };
  });
}

async function replacePerms(c: PoolClient, tenantId: string, roleId: string, perms: string[]) {
  await c.query(`delete from org_role_permission where role_id = $1`, [roleId]);
  for (const p of perms) await c.query(`insert into org_role_permission (tenant_id, role_id, permission) values ($1,$2,$3)`, [tenantId, roleId, p]);
  await c.query(`update org_role set version = version + 1, updated_at = now() where id = $1`, [roleId]);
}

/** Sets what a built-in role (member, integration_admin) or a custom role may do. The administrator role and the administrator-only permissions cannot be changed. */
export async function setRolePermissions(pool: Pool, who: Who, target: { key: "member" | "integration_admin" } | { id: string }, requested: string[]): Promise<ROut<{ perms: string[] }>> {
  if (!can(who, "roles.manage")) return bad("Only an administrator can manage roles.");
  const perms = allowedForRole(requested ?? []);
  return withTenant(pool, who.tenantId, async (c) => {
    let id: string | undefined;
    if ("key" in target) {
      if (target.key !== "member" && target.key !== "integration_admin") return bad("The administrator role cannot be changed.");
      id = (await c.query(`select id from org_role where system_key = $1`, [target.key])).rows[0]?.id;
      if (!id) id = (await c.query(`insert into org_role (tenant_id, name, base_role, system_key) values ($1,$2,$3,$3) returning id`,
        [who.tenantId, target.key === "member" ? "Member" : "Integration administrator", target.key])).rows[0].id;
    } else {
      if (!/^[0-9a-f-]{36}$/i.test(target.id)) return bad("Role not found.");
      id = (await c.query(`select id from org_role where id = $1 for update`, [target.id])).rows[0]?.id;
      if (!id) return bad("Role not found.");
    }
    await replacePerms(c, who.tenantId, id!, perms);
    await audit(c, internal(who), null, "roles.permissions_set", { role: "key" in target ? target.key : target.id, permissions: perms });
    return { ok: true as const, perms };
  });
}

export async function createRole(pool: Pool, who: Who, input: { name: string; description?: string; baseRole?: string; perms: string[] }): Promise<ROut<{ id: string }>> {
  if (!can(who, "roles.manage")) return bad("Only an administrator can manage roles.");
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  if (!NAME_RE.test(name)) return bad("Name the role in 2 to 60 characters.");
  if (["administrator", "member", "integration administrator"].includes(name.toLowerCase())) return bad("A role with that name already exists.");
  const base = input.baseRole === "integration_admin" ? "integration_admin" : "member";
  const description = String(input.description ?? "").trim().slice(0, 300) || null;
  return withTenant(pool, who.tenantId, async (c) => {
    if (((await c.query(`select count(*)::int n from org_role where system_key is null`)).rows[0].n as number) >= 30) return bad("An organisation can have at most 30 custom roles.");
    try {
      const id = (await c.query(`insert into org_role (tenant_id, name, description, base_role) values ($1,$2,$3,$4) returning id`, [who.tenantId, name, description, base])).rows[0].id as string;
      await replacePerms(c, who.tenantId, id, allowedForRole(input.perms ?? []));
      await audit(c, internal(who), null, "roles.created", { role: id, name });
      return { ok: true as const, id };
    } catch (e) {
      return bad((e as { code?: string }).code === "23505" ? "A role with that name already exists." : "The role could not be created.");
    }
  });
}

export async function deleteRole(pool: Pool, who: Who, roleId: string): Promise<ROut> {
  if (!can(who, "roles.manage")) return bad("Only an administrator can manage roles.");
  if (!/^[0-9a-f-]{36}$/i.test(roleId)) return bad("Role not found.");
  return withTenant(pool, who.tenantId, async (c) => {
    const r = (await c.query(`select id, name, system_key from org_role where id = $1 for update`, [roleId])).rows[0];
    if (!r) return bad("Role not found.");
    if (r.system_key) return bad("Built-in roles cannot be deleted.");
    if ((await c.query(`select 1 from membership where org_role_id = $1 limit 1`, [roleId])).rowCount) return bad("People still have this role. Give them another role first.");
    await c.query(`delete from org_role where id = $1`, [roleId]);
    await audit(c, internal(who), null, "roles.deleted", { role: roleId, name: r.name });
    return { ok: true as const };
  });
}

/** Gives a person a custom role (or null to return them to their built-in role). The custom role's base role must match the person's current base role, or they are re-based with it. */
export async function assignRole(pool: Pool, who: Who, membershipId: string, roleId: string | null): Promise<ROut> {
  if (!can(who, "users.manage")) return bad("Only an administrator can manage users.");
  if (!/^[0-9a-f-]{36}$/i.test(membershipId) || (roleId !== null && !/^[0-9a-f-]{36}$/i.test(roleId))) return bad("Person not found.");
  return withTenant(pool, who.tenantId, async (c) => {
    const m = (await c.query(`select id, role from membership where id = $1 for update`, [membershipId])).rows[0];
    if (!m) return bad("Person not found.");
    if (m.role === "admin") return bad("Administrators have every permission. Change their role first.");
    if (roleId === null) { await c.query(`update membership set org_role_id = null where id = $1`, [membershipId]); }
    else {
      const r = (await c.query(`select id, base_role, system_key from org_role where id = $1`, [roleId])).rows[0];
      if (!r || r.system_key) return bad("Role not found.");
      if (r.base_role !== m.role) {
        if ((await c.query(`select 1 from membership where tenant_id = $1 and user_id = (select user_id from membership where id = $2) and role = $3`, [who.tenantId, membershipId, r.base_role])).rowCount) return bad("That person already has this role.");
        await c.query(`update membership set role = $2, org_role_id = $3 where id = $1`, [membershipId, r.base_role, roleId]);
      } else await c.query(`update membership set org_role_id = $2 where id = $1`, [membershipId, roleId]);
    }
    await audit(c, internal(who), null, "roles.assigned", { membership: membershipId, role: roleId });
    return { ok: true as const };
  });
}

/** What one person can do, for the "who can do what" check. */
export async function explainPerson(pool: Pool, who: Who, membershipId: string): Promise<ROut<{ email: string; role: string; roleName: string; perms: string[] }>> {
  if (!can(who, "roles.manage")) return bad("Only an administrator can manage roles.");
  if (!/^[0-9a-f-]{36}$/i.test(membershipId)) return bad("Person not found.");
  return withTenant(pool, who.tenantId, async (c) => {
    const m = (await c.query(`select m.id, m.role, u.email, r.name as role_name from membership m join app_user u on u.id = m.user_id left join org_role r on r.id = m.org_role_id where m.id = $1`, [membershipId])).rows[0];
    if (!m) return bad("Person not found.");
    return { ok: true as const, email: m.email, role: m.role, roleName: m.role_name ?? (m.role === "admin" ? "Administrator" : m.role === "member" ? "Member" : "Integration administrator"), perms: await permsFor(c, membershipId, m.role) };
  });
}
