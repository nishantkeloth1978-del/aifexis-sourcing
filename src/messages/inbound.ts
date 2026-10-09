import type { Pool } from "pg";
import { withTenant } from "@/authz";
import type { SupplierWho } from "@/suppliers/service";
import { supplierSend, type FileIn } from "./service";

/**
 * Reply by e-mail. A supplier answers the notification e-mail; the mail provider posts the reply here.
 * The Reply-To address carries an unguessable token that names one private thread and one person, and the sender must match that person.
 */
export interface InboundMail { token: string | null; from: string | null; text: string; subject: string; attachments: FileIn[]; messageId: string | null }
export type InboundResult = { ok: true; duplicate?: boolean } | { ok: false; reason: "no_token" | "unknown_token" | "wrong_sender" | "empty" | "refused"; error?: string };

const addr = (s: unknown) => {
  const m = String(s ?? "").match(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
};

/** Drops the quoted history, the signature and our own footer, so only what the supplier actually wrote is kept. */
export function stripQuoted(raw: string): string {
  const lines = String(raw ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const stop = [/^-{2,}\s*original message\s*-{2,}/i, /^_{5,}$/, /^-{5,}\s*forwarded/i, /^from:\s.+/i, /^sent from my /i, /^--$/, /^reply to this e-?mail to answer/i, /^open aifexis:/i];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (/^on .+wrote:$/i.test(l)) break;
    if (/^on .+[^:]$/i.test(l) && /wrote:\s*$/i.test(lines[i + 1] ?? "")) break;   // a header the mail program wrapped over two lines
    if (stop.some((r) => r.test(l))) break;
    if (l.startsWith(">")) continue;
    out.push(lines[i]!);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Accepts the Postmark inbound shape and a plain {from,to,text,attachments} shape. */
export function parseInbound(p: unknown): InboundMail {
  const o = (p && typeof p === "object" ? p : {}) as Obj;
  const toList: string[] = [];
  const push = (v: unknown) => { if (typeof v === "string") toList.push(v); };
  push(o.OriginalRecipient); push(o.To); push(o.to); push(o.recipient);
  for (const k of ["ToFull", "toFull"]) if (Array.isArray(o[k])) for (const t of o[k] as Obj[]) push(t.Email ?? t.email);
  let token: string | null = null;
  for (const t of toList) { const m = t.match(/reply\+([a-f0-9]{32})@/i); if (m) { token = m[1]!.toLowerCase(); break; } }
  const from = addr(o.FromFull && typeof o.FromFull === "object" ? (o.FromFull as Obj).Email : null) ?? addr(o.From ?? o.from ?? o.sender);
  const text = str(o.StrippedTextReply) || str(o.TextBody) || str(o.text) || str(o.body);
  const atts: FileIn[] = [];
  const list = (Array.isArray(o.Attachments) ? o.Attachments : Array.isArray(o.attachments) ? o.attachments : []) as Obj[];
  for (const a of list.slice(0, 3)) {
    const name = str(a.Name ?? a.filename ?? a.name), content = str(a.Content ?? a.content);
    if (name && content) atts.push({ filename: name, bytes: Buffer.from(content, "base64") });
  }
  return { token, from, text, subject: str(o.Subject ?? o.subject), attachments: atts, messageId: str(o.MessageID ?? o.messageId ?? o.message_id) || null };
}

type Resolved = { kind: "go"; who: SupplierWho; eventId: string } | { kind: "stop"; result: InboundResult };

export async function handleInbound(pool: Pool, mail: InboundMail): Promise<InboundResult> {
  if (!mail.token) return { ok: false, reason: "no_token" };
  const res = (await pool.query(`select tenant_id, thread_id, user_id from resolve_reply_token($1)`, [mail.token])).rows[0];
  if (!res) return { ok: false, reason: "unknown_token" };
  const body = stripQuoted(mail.text).slice(0, 4000);
  const r: Resolved = await withTenant(pool, res.tenant_id as string, async (c): Promise<Resolved> => {
    const u = (await c.query(`select u.email, su.id as supplier_user_id, su.supplier_id, so.name as supplier_name, t.name as tenant_name, th.event_id, th.lane, th.supplier_id as thread_supplier
                                from app_user u join supplier_user su on su.user_id = u.id and su.tenant_id = $1
                                join supplier_org so on so.tenant_id = su.tenant_id and so.id = su.supplier_id
                                join tenant t on t.id = su.tenant_id
                                join message_thread th on th.id = $2 and th.tenant_id = su.tenant_id
                               where u.id = $3`, [res.tenant_id, res.thread_id, res.user_id])).rows[0];
    if (!u || u.lane !== "private" || u.thread_supplier !== u.supplier_id) return { kind: "stop", result: { ok: false, reason: "unknown_token" } };
    if (!mail.from || mail.from !== String(u.email).toLowerCase()) return { kind: "stop", result: { ok: false, reason: "wrong_sender" } };
    if (!body) return { kind: "stop", result: { ok: false, reason: "empty" } };
    const dup = (await c.query(`select 1 from message where thread_id = $1 and author_kind = 'supplier' and author_user_id = $2 and body = $3 and created_at > now() - interval '15 minutes'`, [res.thread_id, res.user_id, body])).rowCount;
    if (dup) return { kind: "stop", result: { ok: true, duplicate: true } };
    return { kind: "go", eventId: u.event_id as string, who: { tenantId: res.tenant_id, supplierId: u.supplier_id, supplierUserId: u.supplier_user_id, supplierName: u.supplier_name, tenantName: u.tenant_name, email: u.email } };
  });
  if (r.kind === "stop") return r.result;
  const sent = await supplierSend(pool, r.who, r.eventId, body, mail.attachments);
  if (sent.ok) return { ok: true };
  // Tell the sender why the reply was not added, so it is never lost silently.
  await withTenant(pool, r.who.tenantId, (c) => c.query(`insert into email_outbox (tenant_id, event_id, to_email, subject, body) values ($1,$2,$3,$4,$5)`,
    [r.who.tenantId, r.eventId, r.who.email, "Aifexis: your reply was not added", `Your e-mail reply could not be added to the conversation: ${sent.error}\n\nSign in to Aifexis to continue.`])).catch(() => undefined);
  return { ok: false, reason: "refused", error: sent.error };
}
