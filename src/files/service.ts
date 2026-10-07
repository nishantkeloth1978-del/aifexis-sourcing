import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { audit, loadSubject, resolvePermitted, signedUrl, withTenant, type Actor } from "@/authz";
import type { Who } from "@/events/service";
import type { SupplierWho } from "@/suppliers/service";

export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_BID_FILES = 8;
export type FileOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface FileRow { id: string; filename: string; size: number; uploadedAt: string; supplierId: string | null; supplierName?: string }

const TYPES: Record<string, { mime: string; magic?: number[][] }> = {
  pdf: { mime: "application/pdf", magic: [[0x25, 0x50, 0x44, 0x46]] },
  png: { mime: "image/png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
  jpg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
  jpeg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: [[0x50, 0x4b]] },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: [[0x50, 0x4b]] },
  zip: { mime: "application/zip", magic: [[0x50, 0x4b]] },
  txt: { mime: "text/plain" }, csv: { mime: "text/csv" },
};
export const ALLOWED_EXTENSIONS = Object.keys(TYPES);

/** Name and content checks. The type comes from the extension and the first bytes, never from what the browser claims. */
export function checkFile(filename: string, bytes: Buffer): FileOut<{ name: string; mime: string }> {
  const name = (filename ?? "").replace(/^.*[\\/]/, "").replace(/[^\w.\- ()]/g, "_").trim().slice(0, 150);
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const t = TYPES[ext];
  if (!name || !t) return { ok: false, error: `That file type is not accepted. Use: ${ALLOWED_EXTENSIONS.join(", ")}.` };
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > MAX_BYTES) return { ok: false, error: "The file is larger than 4 MB." };
  if (t.magic && !t.magic.some((m) => m.every((b, i) => bytes[i] === b))) return { ok: false, error: "The file content does not match its type." };
  return { ok: true, name, mime: t.mime };
}

const internal = (w: Who): Actor => ({ kind: "internal", userId: w.userId, tenantId: w.tenantId });
const supplierActor = (w: SupplierWho): Actor => ({ kind: "supplier", supplierUserId: w.supplierUserId, tenantId: w.tenantId });

async function insertFile(c: import("pg").PoolClient, tenantId: string, eventId: string, supplierId: string | null, cls: "D2" | "D6", name: string, mime: string, bytes: Buffer, by: string | null) {
  const id = randomUUID();
  await c.query(`insert into stored_object (tenant_id, id, event_id, supplier_id, data_class, path, created_by) values ($1,$2,$3,$4,$5,$6,$7)`, [tenantId, id, eventId, supplierId, cls, `db/${tenantId}/${eventId}/${id}`, by]);
  await c.query(`insert into stored_blob (tenant_id, object_id, filename, mime, size_bytes, content) values ($1,$2,$3,$4,$5,$6)`, [tenantId, id, name, mime, bytes.length, bytes]);
  return id;
}

const rowOf = (r: { id: string; filename: string; size_bytes: number; created_at: Date; supplier_id: string | null; name?: string }): FileRow =>
  ({ id: r.id, filename: r.filename, size: r.size_bytes, uploadedAt: new Date(r.created_at).toISOString(), supplierId: r.supplier_id, ...(r.name ? { supplierName: r.name } : {}) });

// ---------- tender documents (class D2), added by the buyer ----------
export async function uploadTenderDocument(pool: Pool, who: Who, eventId: string, filename: string, bytes: Buffer): Promise<FileOut<{ id: string }>> {
  const chk = checkFile(filename, bytes); if (!chk.ok) return chk;
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state from sourcing_event where id = $1 for update`, [eventId])).rows[0];
    if (!ev) return { ok: false as const, error: "Event not found." };
    if (!(await loadSubject(c, who.userId, eventId)).ownRoles.has("buyer")) return { ok: false as const, error: "Only the buyer of this event can add tender documents." };
    if (!["draft", "published"].includes(ev.state)) return { ok: false as const, error: "Documents can only be added while the event is a draft or open." };
    if ((await c.query(`select count(*)::int n from stored_object where event_id = $1 and data_class = 'D2'`, [eventId])).rows[0].n >= 30) return { ok: false as const, error: "An event can have at most 30 tender documents." };
    const id = await insertFile(c, who.tenantId, eventId, null, "D2", chk.name, chk.mime, bytes, who.membershipId);
    await audit(c, internal(who), eventId, "file.tender_uploaded", { id, name: chk.name });
    return { ok: true as const, id };
  });
}

export async function listTenderDocuments(pool: Pool, tenantId: string, actor: Actor, eventId: string): Promise<FileRow[]> {
  return withTenant(pool, tenantId, async (c) => {
    const r = await resolvePermitted(c, actor, eventId);
    if (!r.ok || !r.permitted.D2) return [];
    return (await c.query(`select o.id, b.filename, b.size_bytes, o.created_at, o.supplier_id from stored_object o join stored_blob b on b.tenant_id = o.tenant_id and b.object_id = o.id
                            where o.event_id = $1 and o.data_class = 'D2' order by o.created_at`, [eventId])).rows.map(rowOf);
  });
}
export const tenderDocsForStaff = (pool: Pool, who: Who, eventId: string) => listTenderDocuments(pool, who.tenantId, internal(who), eventId);
export const tenderDocsForSupplier = (pool: Pool, who: SupplierWho, eventId: string) => listTenderDocuments(pool, who.tenantId, supplierActor(who), eventId);

// ---------- supplier attachments to a bid (class D6) ----------
export async function uploadBidAttachment(pool: Pool, who: SupplierWho, eventId: string, filename: string, bytes: Buffer): Promise<FileOut<{ id: string }>> {
  const chk = checkFile(filename, bytes); if (!chk.ok) return chk;
  return withTenant(pool, who.tenantId, async (c) => {
    const actor = supplierActor(who);
    const r = await resolvePermitted(c, actor, eventId);
    if (!r.ok) return { ok: false as const, error: "This event is not available to you." };
    if (r.event.state !== "published" || (r.event.closesAt && r.event.closesAt.getTime() <= Date.now())) return { ok: false as const, error: "This event is no longer open for bids." };
    if ((await c.query(`select count(*)::int n from stored_object where event_id = $1 and supplier_id = $2 and data_class = 'D6'`, [eventId, who.supplierId])).rows[0].n >= MAX_BID_FILES) return { ok: false as const, error: `You can attach at most ${MAX_BID_FILES} files.` };
    const id = await insertFile(c, who.tenantId, eventId, who.supplierId, "D6", chk.name, chk.mime, bytes, null);
    await audit(c, actor, eventId, "file.bid_uploaded", { id });
    return { ok: true as const, id };
  });
}

export async function listBidAttachments(pool: Pool, who: SupplierWho, eventId: string): Promise<FileRow[]> {
  return withTenant(pool, who.tenantId, async (c) =>
    (await c.query(`select o.id, b.filename, b.size_bytes, o.created_at, o.supplier_id from stored_object o join stored_blob b on b.tenant_id = o.tenant_id and b.object_id = o.id
                     where o.event_id = $1 and o.supplier_id = $2 and o.data_class = 'D6' order by o.created_at`, [eventId, who.supplierId])).rows.map(rowOf));
}

/** Attachments of every bidder, for staff who may read technical responses (envelope open). */
export async function bidAttachmentsForStaff(pool: Pool, who: Who, eventId: string): Promise<FileRow[]> {
  return withTenant(pool, who.tenantId, async (c) => {
    const r = await resolvePermitted(c, internal(who), eventId);
    if (!r.ok || !r.permitted.D6) return [];
    const rows = (await c.query(`select o.id, b.filename, b.size_bytes, o.created_at, o.supplier_id, s.name from stored_object o join stored_blob b on b.tenant_id = o.tenant_id and b.object_id = o.id
                                  join supplier_org s on s.tenant_id = o.tenant_id and s.id = o.supplier_id where o.event_id = $1 and o.data_class = 'D6' order by s.name, o.created_at`, [eventId])).rows;
    return rows.map(rowOf);
  });
}

export async function deleteSupplierFile(pool: Pool, who: SupplierWho, eventId: string, fileId: string): Promise<FileOut> {
  return withTenant(pool, who.tenantId, async (c) => {
    const r = await resolvePermitted(c, supplierActor(who), eventId);
    if (!r.ok) return { ok: false as const, error: "This event is not available to you." };
    if (r.event.state !== "published" || (r.event.closesAt && r.event.closesAt.getTime() <= Date.now())) return { ok: false as const, error: "Files can no longer be changed." };
    const n = (await c.query(`delete from stored_object where id = $1 and event_id = $2 and supplier_id = $3 and data_class = 'D6'`, [fileId, eventId, who.supplierId])).rowCount;
    return n ? { ok: true as const } : { ok: false as const, error: "File not found." };
  });
}
export async function deleteTenderDocument(pool: Pool, who: Who, eventId: string, fileId: string): Promise<FileOut> {
  return withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev) return { ok: false as const, error: "Event not found." };
    if (!(await loadSubject(c, who.userId, eventId)).ownRoles.has("buyer")) return { ok: false as const, error: "Only the buyer of this event can remove tender documents." };
    if (ev.state !== "draft") return { ok: false as const, error: "Published documents cannot be removed, only added to." };
    const n = (await c.query(`delete from stored_object where id = $1 and event_id = $2 and data_class = 'D2'`, [fileId, eventId])).rowCount;
    return n ? { ok: true as const } : { ok: false as const, error: "File not found." };
  });
}

/** Download: authorized by the same central check that issues signed URLs. Unknown and not-permitted files look identical. */
export async function readFile(pool: Pool, tenantId: string, actor: Actor, fileId: string): Promise<{ filename: string; mime: string; content: Buffer } | null> {
  if (!/^[0-9a-f-]{36}$/.test(fileId)) return null;
  return withTenant(pool, tenantId, async (c) => {
    const s = await signedUrl(c, actor, fileId, 30);
    if (!s.allow) return null;
    const b = (await c.query(`select filename, mime, content from stored_blob where object_id = $1`, [fileId])).rows[0];
    if (!b) return null;
    const ev = (await c.query(`select event_id from stored_object where id = $1`, [fileId])).rows[0];
    await audit(c, actor, ev?.event_id ?? null, "file.downloaded", { fileId });
    return { filename: b.filename, mime: b.mime, content: b.content as Buffer };
  });
}
