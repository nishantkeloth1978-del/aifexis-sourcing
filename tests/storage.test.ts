import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/authz";
import type { Who } from "@/events/service";
import { deleteTenderDocument, readFile, uploadBidAttachment, uploadTenderDocument } from "@/files/service";
import { scanFile, screenBuiltIn, zipNames } from "@/files/scan";
import { backendName } from "@/files/storage";
import type { SupplierWho } from "@/suppliers/service";
import { adminClient, makeEvent, makePool, seedTenant, type World } from "./helpers/db";

let admin: Client, pool: Pool, X: World;
const staff = (p: keyof World["people"]): Who => ({ tenantId: X.tenantId, userId: X.people[p].userId, membershipId: X.people[p].membershipId, role: "member" } as Who);
const sup = (i: 0 | 1 | 2): SupplierWho => ({ tenantId: X.tenantId, supplierId: X.suppliers[i].id, supplierUserId: X.suppliers[i].supplierUserId, supplierName: "S", tenantName: "T", email: "e@x.com" });
const supActor = (i: 0 | 1 | 2): Actor => ({ kind: "supplier", supplierUserId: X.suppliers[i].supplierUserId, tenantId: X.tenantId });
const PDF = Buffer.from("%PDF-1.4 clean document");
beforeAll(async () => { admin = await adminClient(); pool = makePool(); X = await seedTenant(admin, "storage"); });
afterAll(async () => { await pool.end(); await admin.end(); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.MALWARE_SCAN_URL; });

function zipWith(names: string[]): Buffer {            // a minimal valid zip with empty stored entries
  const parts: Buffer[] = [], cd: Buffer[] = []; let off = 0;
  for (const n of names) {
    const nb = Buffer.from(n), lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb); cd.push(ch, nb); off += 30 + nb.length;
  }
  const cdb = Buffer.concat(cd), eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(names.length, 8); eo.writeUInt16LE(names.length, 10); eo.writeUInt32LE(cdb.length, 12); eo.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdb, eo]);
}

describe("screening", () => {
  it("blocks the test signature, programs, macros, scripts and risky PDFs, and lets clean files through", () => {
    expect(screenBuiltIn("a.txt", Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"))).toMatchObject({ ok: false });
    expect(screenBuiltIn("a.txt", Buffer.from("MZ\x90\x00 program"))).toMatchObject({ ok: false });
    expect(screenBuiltIn("a.csv", Buffer.from("#!/bin/sh\nrm -rf"))).toMatchObject({ ok: false });
    expect(screenBuiltIn("a.pdf", Buffer.from("%PDF-1.4 << /JavaScript (app.alert(1)) >>"))).toMatchObject({ ok: false });
    expect(screenBuiltIn("a.pdf", Buffer.from("%PDF-1.4 << /OpenAction /GoTo >>"))).toMatchObject({ ok: true });
    expect(zipNames(zipWith(["a.txt", "b/c.docx"]))).toEqual(["a.txt", "b/c.docx"]);
    expect(screenBuiltIn("s.xlsx", zipWith(["xl/workbook.xml", "xl/vbaProject.bin"]))).toMatchObject({ ok: false });
    expect(screenBuiltIn("s.xlsx", zipWith(["xl/workbook.xml"]))).toMatchObject({ ok: true });
    expect(screenBuiltIn("p.zip", zipWith(["docs/readme.txt", "setup.exe"]))).toMatchObject({ ok: false });
    expect(screenBuiltIn("p.zip", zipWith(["docs/readme.txt"]))).toMatchObject({ ok: true });
    expect(screenBuiltIn("broken.zip", Buffer.from("PK not really a zip"))).toMatchObject({ ok: false });
    expect(screenBuiltIn("ok.pdf", PDF)).toMatchObject({ ok: true });
  });
  it("an external scanner adds to the screening and fails closed", async () => {
    const env = { MALWARE_SCAN_URL: "https://scan.invalid/x", MALWARE_SCAN_TOKEN: "t" } as unknown as NodeJS.ProcessEnv;
    const f = (clean: boolean, status = 200) => (async () => new Response(JSON.stringify({ clean }), { status })) as unknown as typeof fetch;
    expect(await scanFile("a.pdf", PDF, env, f(true))).toEqual({ ok: true, engine: "clean" });
    expect(await scanFile("a.pdf", PDF, env, f(false))).toMatchObject({ ok: false });
    expect(await scanFile("a.pdf", PDF, env, f(true, 500))).toMatchObject({ ok: false });
    expect(await scanFile("a.pdf", PDF, env, (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toMatchObject({ ok: false });
    expect(await scanFile("a.pdf", PDF, {} as NodeJS.ProcessEnv)).toEqual({ ok: true, engine: "screened" });
  });
});

describe("uploads", () => {
  it("a blocked file is refused before anything is stored", async () => {
    const e = await makeEvent(admin, X, "published", { invite: [0], withBids: false });
    const r = await uploadBidAttachment(pool, sup(0), e.id, "macro.xlsx", zipWith(["xl/vbaProject.bin"]));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("blocked") });
    expect((await admin.query(`select 1 from stored_object where event_id = $1`, [e.id])).rowCount).toBe(0);
  });
  it("files go to the database without storage keys, and the scan result is recorded", async () => {
    expect(backendName({} as NodeJS.ProcessEnv)).toBe("db");
    const e = await makeEvent(admin, X, "published", { invite: [0], withBids: false });
    const up = await uploadTenderDocument(pool, staff("buyer"), e.id, "spec.pdf", PDF);
    if (!up.ok) throw new Error(up.error);
    expect((await admin.query(`select storage, scan, content is not null as has from stored_blob where object_id = $1`, [up.id])).rows[0]).toMatchObject({ storage: "db", scan: "screened", has: true });
  });
  it("with a storage key, bytes go to the bucket, come back through the same authorization, and are removed with the file", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key"; process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
    expect(backendName()).toBe("supabase");
    const bucket = new Map<string, Buffer>(); const calls: string[] = []; let bucketExists = false;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const m = init.method ?? "GET"; calls.push(`${m} ${url}`);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer service-key");
      if (url.endsWith("/storage/v1/bucket")) { bucketExists = true; return new Response("{}", { status: 200 }); }
      if (!bucketExists && m === "POST") return new Response('{"error":"Bucket not found"}', { status: 404 });
      const key = decodeURIComponent(url.replace("https://proj.supabase.co/storage/v1/object/aifexis-files/", ""));
      if (m === "POST") { bucket.set(key, Buffer.from(init.body as Uint8Array)); return new Response("{}", { status: 200 }); }
      if (m === "GET") return bucket.has(key) ? new Response(new Uint8Array(bucket.get(key)!)) : new Response("no", { status: 404 });
      if (m === "DELETE") { for (const k of JSON.parse(String(init.body)).prefixes as string[]) bucket.delete(k); return new Response("[]", { status: 200 }); }
      return new Response("?", { status: 500 });
    });
    const e = await makeEvent(admin, X, "draft", { invite: [0, 1], withBids: false });
    const up = await uploadTenderDocument(pool, staff("buyer"), e.id, "spec.pdf", PDF);
    if (!up.ok) throw new Error(up.error);
    const row = (await admin.query(`select storage, storage_key, content from stored_blob where object_id = $1`, [up.id])).rows[0];
    expect(row).toMatchObject({ storage: "supabase", content: null }); expect(bucket.get(row.storage_key)!.equals(PDF)).toBe(true);
    expect(calls.some((c) => c.includes("/bucket"))).toBe(true);        // created the private bucket on first use
    await admin.query(`update sourcing_event set state = 'published' where id = $1`, [e.id]);
    expect((await readFile(pool, X.tenantId, supActor(1), up.id))?.content.equals(PDF)).toBe(true);
    expect(await readFile(pool, X.tenantId, supActor(2), up.id)).toBeNull();                       // not invited: same answer as for a missing file
    const e2 = await makeEvent(admin, X, "draft", { invite: [0], withBids: false });
    const d = await uploadTenderDocument(pool, staff("buyer"), e2.id, "old.pdf", PDF);
    if (!d.ok) throw new Error(d.error);
    expect(bucket.size).toBe(2);
    expect(await deleteTenderDocument(pool, staff("buyer"), e2.id, d.id)).toMatchObject({ ok: true });
    expect(bucket.size).toBe(1);
  });
  it("a failed row insert leaves no object behind", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key"; process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
    const bucket = new Map<string, number>();
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const key = url.split("/aifexis-files/")[1] ?? "";
      if (init.method === "POST") { bucket.set(key, 1); return new Response("{}"); }
      if (init.method === "DELETE") { for (const k of JSON.parse(String(init.body)).prefixes as string[]) bucket.delete(encodeURI(k)); return new Response("[]"); }
      return new Response("?", { status: 500 });
    });
    const e = await makeEvent(admin, X, "draft", { invite: [0], withBids: false });
    await admin.query(`alter table stored_blob add constraint force_fail check (filename <> 'boom.pdf')`);
    try { await expect(uploadTenderDocument(pool, staff("buyer"), e.id, "boom.pdf", PDF)).rejects.toThrow(); }
    finally { await admin.query(`alter table stored_blob drop constraint force_fail`); }
    expect(bucket.size).toBe(0);
  });
});
