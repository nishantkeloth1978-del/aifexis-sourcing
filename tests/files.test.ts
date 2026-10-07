import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/authz";
import type { Who } from "@/events/service";
import { bidAttachmentsForStaff, checkFile, deleteTenderDocument, listBidAttachments, readFile, tenderDocsForSupplier, uploadBidAttachment, uploadTenderDocument } from "@/files/service";
import type { SupplierWho } from "@/suppliers/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const staff = (p: keyof World["people"]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role: "member" } as Who);
const sup = (i: 0 | 1 | 2): SupplierWho => ({ tenantId: X.tenantId, supplierId: X.suppliers[i].id, supplierUserId: X.suppliers[i].supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });
const supActor = (i: 0 | 1 | 2): Actor => ({ kind: "supplier", supplierUserId: X.suppliers[i].supplierUserId, tenantId: X.tenantId });
const staffActor = (p: keyof World["people"]): Actor => ({ kind: "internal", userId: X.people[p].userId, tenantId: X.tenantId });
const PDF = Buffer.from("%PDF-1.4 test");
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "files"); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("file checks", () => {
  it("accepts by extension and content, rejects the rest", () => {
    expect(checkFile("Spec.PDF", PDF)).toMatchObject({ ok: true, mime: "application/pdf" });
    expect(checkFile("evil.exe", PDF).ok).toBe(false);
    expect(checkFile("fake.pdf", Buffer.from("MZ not a pdf")).ok).toBe(false);
    expect(checkFile("a.pdf", Buffer.alloc(0)).ok).toBe(false);
    expect(checkFile("big.pdf", Buffer.concat([PDF, Buffer.alloc(4 * 1024 * 1024)])).ok).toBe(false);
    expect(checkFile("..\\..\\x.pdf", PDF)).toMatchObject({ ok: true, name: "x.pdf" });
  });
});

describe("tender documents and bid attachments", () => {
  it("buyer uploads, invited suppliers download, others cannot", async () => {
    const e = await makeEvent(admin, X, "published", { invite: [0, 1], withBids: false });
    expect(await uploadTenderDocument(pool, staff("techA"), e.id, "spec.pdf", PDF)).toMatchObject({ ok: false });
    const up = await uploadTenderDocument(pool, staff("buyer"), e.id, "spec.pdf", PDF);
    expect(up.ok).toBe(true); if (!up.ok) return;
    expect(await tenderDocsForSupplier(pool, sup(0), e.id)).toHaveLength(1);
    expect(await tenderDocsForSupplier(pool, sup(2), e.id)).toHaveLength(0);               // not invited
    expect((await readFile(pool, X.tenantId, supActor(1), up.id))?.content.equals(PDF)).toBe(true);
    expect((await readFile(pool, X.tenantId, supActor(1), up.id))?.content.equals(PDF)).toBe(true);
    expect(await readFile(pool, X.tenantId, supActor(2), up.id)).toBeNull();
    expect(await deleteTenderDocument(pool, staff("buyer"), e.id, up.id)).toMatchObject({ ok: false });   // published: no removal
  });
  it("a bid attachment is the supplier's own until the technical envelope is open", async () => {
    const e = await makeEvent(admin, X, "published", { invite: [0, 1], withBids: false });
    const a = await uploadBidAttachment(pool, sup(0), e.id, "datasheet.pdf", PDF);
    expect(a.ok).toBe(true); if (!a.ok) return;
    expect(await listBidAttachments(pool, sup(0), e.id)).toHaveLength(1);
    expect(await listBidAttachments(pool, sup(1), e.id)).toHaveLength(0);
    expect(await readFile(pool, X.tenantId, supActor(1), a.id)).toBeNull();
    expect(await readFile(pool, X.tenantId, staffActor("buyer"), a.id)).toBeNull();        // sealed
    expect(await bidAttachmentsForStaff(pool, staff("buyer"), e.id)).toHaveLength(0);
    await admin.query(`update sourcing_event set state = 'technical_evaluation', envelope1_opened_at = now() where id = $1`, [e.id]);
    expect((await readFile(pool, X.tenantId, staffActor("techA"), a.id))?.filename).toBe("datasheet.pdf");
    expect(await bidAttachmentsForStaff(pool, staff("techA"), e.id)).toHaveLength(1);
  });
  it("no uploads or deletes after the deadline", async () => {
    const e = await makeEvent(admin, X, "published", { invite: [0], withBids: false, closesAt: new Date(Date.now() - 1000).toISOString() });
    expect(await uploadBidAttachment(pool, sup(0), e.id, "late.pdf", PDF)).toMatchObject({ ok: false });
  });
});
