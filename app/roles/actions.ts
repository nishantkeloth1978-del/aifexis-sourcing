"use server";
import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { stepUpSession } from "@/lib/stepup";
import { withinRate } from "@/lib/guard";
import { TOO_FAST } from "@/lib/ratelimit";
import { createRole, deleteRole, explainPerson, setRolePermissions } from "@/access/roles";

const NO_SESSION = { ok: false as const, error: "Your session has ended. Sign in again." };
const FAILED = { ok: false as const, error: "That could not be saved. Try again." };
async function run<T>(fn: (s: NonNullable<Awaited<ReturnType<typeof getSession>>>) => Promise<T>, sensitive = true) {
  const s = sensitive ? await stepUpSession("/roles") : await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.userId, "roles", 60))) return { ok: false as const, error: TOO_FAST };
  try { const r = await fn(s); revalidatePath("/roles"); return r; } catch { return FAILED; }
}
export const setPermissionsAction = async (target: { key: "member" | "integration_admin" } | { id: string }, perms: string[]) => run((s) => setRolePermissions(getPool(), s, target, perms));
export const createRoleAction = async (input: { name: string; description?: string; baseRole?: string; perms: string[] }) => run((s) => createRole(getPool(), s, input));
export const deleteRoleAction = async (id: string) => run((s) => deleteRole(getPool(), s, id));
export const explainPersonAction = async (membershipId: string) => run((s) => explainPerson(getPool(), s, membershipId), false);
