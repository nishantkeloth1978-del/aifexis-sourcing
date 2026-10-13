"use server";
import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { withinRate } from "@/lib/guard";
import { TOO_FAST } from "@/lib/ratelimit";
import { inviteMember, listMembers, revokeInvite, setMemberActive, updateMember } from "@/users/service";

const NO_SESSION = { ok: false as const, error: "Your session has ended. Sign in again." };
const FAILED = { ok: false as const, error: "That could not be saved. Try again." };
async function run<T>(kind: string, fn: (s: NonNullable<Awaited<ReturnType<typeof getSession>>>) => Promise<T>) {
  const s = await getSession(); if (!s) return NO_SESSION;
  if (!(await withinRate(s.userId, kind, 60))) return { ok: false as const, error: TOO_FAST };
  try { const r = await fn(s); revalidatePath("/users"); return r; } catch { return FAILED; }
}
export const listMembersAction = async () => run("users", (s) => listMembers(getPool(), s));
export const inviteAction = async (input: { email: string; role: string; title?: string; department?: string }) => run("userinv", (s) => inviteMember(getPool(), s, input));
export const revokeInviteAction = async (id: string) => run("users", (s) => revokeInvite(getPool(), s, id));
export const updateMemberAction = async (id: string, patch: { role?: string; title?: string | null; department?: string | null }) => run("users", (s) => updateMember(getPool(), s, id, patch));
export const setActiveAction = async (id: string, active: boolean) => run("users", (s) => setMemberActive(getPool(), s, id, active));
