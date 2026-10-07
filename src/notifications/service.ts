import type { Pool } from "pg";
import { withTenant } from "@/authz";

export interface Note { id: number; kind: string; message: string; eventId: string | null; createdAt: string; unread: boolean }

export async function listNotes(pool: Pool, tenantId: string, userId: string, limit = 50): Promise<Note[]> {
  return withTenant(pool, tenantId, async (c) =>
    (await c.query(`select id, kind, message, event_id, created_at, read_at from notification where user_id = $1 order by created_at desc, id desc limit $2`, [userId, limit]))
      .rows.map((r) => ({ id: Number(r.id), kind: r.kind, message: r.message, eventId: r.event_id, createdAt: new Date(r.created_at).toISOString(), unread: !r.read_at })));
}
export async function unreadCount(pool: Pool, tenantId: string, userId: string): Promise<number> {
  return withTenant(pool, tenantId, async (c) => (await c.query(`select count(*)::int n from notification where user_id = $1 and read_at is null`, [userId])).rows[0].n);
}
export async function markAllRead(pool: Pool, tenantId: string, userId: string): Promise<void> {
  await withTenant(pool, tenantId, async (c) => { await c.query(`update notification set read_at = now() where user_id = $1 and read_at is null`, [userId]); });
}

/** Supplier contacts are identified by their supplier_user row; find their person and list their notes. */
export async function listNotesForSupplierUser(pool: Pool, tenantId: string, supplierUserId: string, limit = 20): Promise<Note[]> {
  const uid = await withTenant(pool, tenantId, async (c) => (await c.query(`select user_id from supplier_user where id = $1`, [supplierUserId])).rows[0]?.user_id as string | undefined);
  return uid ? listNotes(pool, tenantId, uid, limit) : [];
}
export async function markAllReadForSupplierUser(pool: Pool, tenantId: string, supplierUserId: string): Promise<void> {
  const uid = await withTenant(pool, tenantId, async (c) => (await c.query(`select user_id from supplier_user where id = $1`, [supplierUserId])).rows[0]?.user_id as string | undefined);
  if (uid) await markAllRead(pool, tenantId, uid);
}
