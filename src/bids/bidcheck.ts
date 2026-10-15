import type { Pool, PoolClient } from "pg";
import { audit, loadSubject, readBidItems, withTenant, type Actor } from "@/authz";
import { can } from "@/access/permissions";
import { claudeFor } from "@/assistant/models";
import { AG_LIMIT, AG_NO_KEY, AG_OFF, runAgent, usageToday } from "@/agents/harness";
import { READER_SYSTEM, checkReading, readerPrompt, type FindingKind, type ReaderLine, type Terms } from "@/agents/reader";
import { anonymousAliases } from "@/evaluation/service";
import type { Who } from "@/events/service";
import { staffReply } from "@/messages/service";
import type { AiDeps } from "@/messages/ai";

export type BOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export type Kind = "price_missing" | "currency" | "gate_declined" | "price_outlier" | FindingKind;
export interface RuleFinding { supplierId: string; revisionNo: number; kind: Kind; severity: "info" | "warn" | "block"; lineNo: number | null; detail: string }
export interface CheckRow { id: string; supplierId: string; supplier: string; revisionNo: number; source: "rule" | "reader"; kind: Kind; severity: string; lineNo: number | null; detail: string; quote: string | null; state: "open" | "asked" | "resolved" | "dismissed" }
export interface CheckScreen { canRun: boolean; sealed: boolean; aiOn: boolean; usage: { used: number; limit: number } | null; rows: CheckRow[]; suppliers: { id: string; name: string }[]; terms: Record<string, Terms> }

export const B_NO_ACCESS = "Only the buyer of this event can check bids.";
export const B_SEALED = "There is nothing to check yet. Bids can be checked after the envelopes are opened.";
export const B_WRONG_STATE = "Bids can be checked once the event has closed.";
export const B_NOT_FOUND = "That finding was not found.";
export const BID_CHECK_MESSAGES = [B_NO_ACCESS, B_SEALED, B_WRONG_STATE, B_NOT_FOUND];

const CHECKABLE = ["closed", "technical_evaluation", "technical_approved", "commercial_evaluation", "recommended", "pending_award"];
const actor = (w: Who): Actor => ({ kind: "internal", userId: w.userId, tenantId: w.tenantId });
interface PriceLine { lineNo: number; unitPrice: string; noBid?: boolean }
export interface BidFacts { supplierId: string; revisionNo: number; currency?: string; lines?: PriceLine[]; gates?: { name: string; answer: boolean }[] }

const cents = (v: string) => { const m = /^(\d+)(?:\.(\d+))?$/.exec(v); return m ? BigInt(m[1]!) * 10000n + BigInt((m[2] ?? "").padEnd(4, "0").slice(0, 4)) : null; };

/** Findings from fixed rules over stored data only. Prices are compared by exact decimal arithmetic. */
export function ruleFindings(bids: BidFacts[], eventCurrency: string): RuleFinding[] {
  const out: RuleFinding[] = [];
  const unit = new Map<number, { supplierId: string; v: bigint }[]>();
  for (const b of bids) for (const l of b.lines ?? []) { const v = cents(l.unitPrice); if (!l.noBid && v !== null && v > 0n) unit.set(l.lineNo, [...(unit.get(l.lineNo) ?? []), { supplierId: b.supplierId, v }]); }
  for (const b of bids) {
    const f = (kind: Kind, severity: RuleFinding["severity"], lineNo: number | null, detail: string) => out.push({ supplierId: b.supplierId, revisionNo: b.revisionNo, kind, severity, lineNo, detail });
    if (b.currency && eventCurrency && b.currency !== eventCurrency) f("currency", "block", null, `Prices are in ${b.currency} but the event is in ${eventCurrency}.`);
    for (const g of b.gates ?? []) if (!g.answer) f("gate_declined", "warn", null, `Answered No to: ${g.name}`.slice(0, 480));
    for (const l of b.lines ?? []) {
      const v = cents(l.unitPrice);
      if (l.noBid) { f("price_missing", "warn", l.lineNo, `Line ${l.lineNo}: the supplier declined to price this line.`); continue; }
      if (v === null || v === 0n) { f("price_missing", "warn", l.lineNo, `Line ${l.lineNo}: no price was given.`); continue; }
      const others = (unit.get(l.lineNo) ?? []).filter((x) => x.supplierId !== b.supplierId).map((x) => x.v).sort((a, c) => (a < c ? -1 : a > c ? 1 : 0));
      if (others.length >= 2) {
        const mid = others.length % 2 ? others[(others.length - 1) / 2]! : (others[others.length / 2 - 1]! + others[others.length / 2]!) / 2n;
        if (mid > 0n && v * 2n < mid) f("price_outlier", "info", l.lineNo, `Line ${l.lineNo}: the unit price is more than 50% below the median of the other bids.`);
        else if (mid > 0n && v > mid * 2n) f("price_outlier", "info", l.lineNo, `Line ${l.lineNo}: the unit price is more than double the median of the other bids.`);
      }
    }
  }
  return out;
}

const isBuyer = async (c: PoolClient, who: Who, eventId: string) => can(who, "evaluation.override") || [...(await loadSubject(c, who.userId, eventId)).effectiveRoles].includes("buyer" as never);

interface Gathered { ref: string; title: string; currency: string; state: string; lines: ReaderLine[]; bids: BidFacts[]; texts: { supplierId: string; revisionNo: number; itemId: string; text: string }[] }

async function gather(c: PoolClient, who: Who, eventId: string): Promise<BOut<{ g: Gathered }>> {
  const ev = (await c.query(`select ref, title, coalesce(currency,'') as currency, state::text as state from sourcing_event where id = $1`, [eventId])).rows[0];
  if (!ev || !(await isBuyer(c, who, eventId))) return { ok: false, error: B_NO_ACCESS };
  if (!CHECKABLE.includes(ev.state)) return { ok: false, error: B_WRONG_STATE };
  const rows = await readBidItems(c, actor(who), eventId);
  if (!rows.length) return { ok: false, error: B_SEALED };
  const lines = (await c.query(`select line_no, description, quantity::text q, unit, specification from event_item where event_id = $1 order by line_no`, [eventId])).rows.map((r): ReaderLine => ({ lineNo: r.line_no, description: r.description, quantity: r.q, unit: r.unit, specification: r.specification }));
  const by = new Map<string, BidFacts>(); const texts: Gathered["texts"] = []; const answers = new Map<string, string[]>();
  for (const r of rows) {
    const b = by.get(r.supplierId) ?? { supplierId: r.supplierId, revisionNo: r.revisionNo };
    const p = r.payload as Record<string, unknown>;
    if (r.kind === "price_lines") { b.currency = String(p.currency ?? ""); b.lines = ((p.lines as PriceLine[]) ?? []).map((l) => ({ lineNo: l.lineNo, unitPrice: String(l.unitPrice), ...(l.noBid ? { noBid: true } : {}) })); }
    if (r.kind === "technical_response") { b.gates = (p.gates as BidFacts["gates"]) ?? []; texts.push({ supplierId: r.supplierId, revisionNo: r.revisionNo, itemId: r.id, text: String(p.text ?? "") }); }
    if (r.kind === "form_response" || r.kind === "commercial_response") answers.set(r.supplierId, [...(answers.get(r.supplierId) ?? []), ...Object.entries((p.answers as Record<string, unknown>) ?? {}).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => `${k}: ${v}`)]);
    by.set(r.supplierId, b);
  }
  for (const t of texts) { const a = answers.get(t.supplierId); if (a?.length) t.text = `${t.text}\n\nAnswers to the questionnaire:\n${a.join("\n")}`.slice(0, 24000); }
  return { ok: true, g: { ref: ev.ref, title: ev.title, currency: ev.currency, state: ev.state, lines, bids: [...by.values()], texts } };
}

/** Runs the fixed rules and, when a Claude key is set, the reader on each bid that can be seen. Findings replace the open ones for those bids; ones a person already handled are not reopened. */
export async function runBidCheck(pool: Pool, who: Who, eventId: string, deps: AiDeps = {}): Promise<BOut<{ rules: number; reader: number; skipped: number; note: string | null }>> {
  const got = await withTenant(pool, who.tenantId, (c) => gather(c, who, eventId));
  if (!got.ok) return got;
  const g = got.g;
  const claude = deps.claude !== undefined ? deps.claude : await claudeFor(pool, who.tenantId).catch(() => null);
  const found: { supplierId: string; revisionNo: number; source: "rule" | "reader"; kind: Kind; severity: string; lineNo: number | null; detail: string; quote: string | null; runId: string | null }[] = [];
  for (const f of ruleFindings(g.bids, g.currency)) found.push({ ...f, source: "rule", quote: null, runId: null });
  const terms: Record<string, Terms> = {}; let reader = 0, skipped = 0, note: string | null = claude ? null : AG_NO_KEY;
  if (claude) {
    for (const t of g.texts) {
      if (t.text.trim().length < 20) { skipped++; continue; }
      const out = await runAgent(pool, who, { agent: "reader", subjectType: "bid", subjectId: t.itemId, system: READER_SYSTEM, user: readerPrompt(g.title, g.lines, t.text), maxTokens: 2500, parse: (raw) => checkReading(raw, { text: t.text, lineNos: g.lines.map((l) => l.lineNo) }) }, { ...deps, claude });
      if (!out.ok) { skipped++; if (out.error === AG_LIMIT || out.error === AG_OFF) { note = out.error; } continue; }
      reader++; terms[t.supplierId] = out.value.terms;
      for (const f of out.value.findings) found.push({ supplierId: t.supplierId, revisionNo: t.revisionNo, source: "reader", kind: f.kind, severity: f.kind === "missing_info" || f.kind === "unclear" ? "info" : "warn", lineNo: f.line, detail: f.detail, quote: f.quote, runId: out.runId });
    }
  }
  await withTenant(pool, who.tenantId, async (c) => {
    const suppliers = [...new Set(g.bids.map((b) => b.supplierId))];
    const readerOk = new Set(Object.keys(terms));
    await c.query(`delete from bid_check where event_id = $1 and state = 'open' and supplier_id = any($2::uuid[]) and (source = 'rule' or supplier_id = any($3::uuid[]))`, [eventId, suppliers, [...readerOk]]);
    for (const f of found) {
      const dup = await c.query(`select 1 from bid_check where event_id = $1 and supplier_id = $2 and revision_no = $3 and kind = $4 and coalesce(line_no, 0) = coalesce($5, 0) and detail = $6 and state <> 'open'`, [eventId, f.supplierId, f.revisionNo, f.kind, f.lineNo, f.detail]);
      if (dup.rowCount) continue;
      await c.query(`insert into bid_check (tenant_id, event_id, supplier_id, revision_no, source, kind, severity, line_no, detail, quote, run_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [who.tenantId, eventId, f.supplierId, f.revisionNo, f.source, f.kind, f.severity, f.lineNo, f.detail.slice(0, 500), f.quote, f.runId]);
    }
    if (Object.keys(terms).length) await c.query(`insert into bid_check_terms_cache (tenant_id, event_id, terms) values ($1,$2,$3) on conflict (tenant_id, event_id) do update set terms = bid_check_terms_cache.terms || $3::jsonb, updated_at = now()`, [who.tenantId, eventId, JSON.stringify(terms)]);
    await audit(c, actor(who), eventId, "bidcheck.run", { agent: "reader", bids: g.bids.length, rules: found.filter((f) => f.source === "rule").length, reader: found.filter((f) => f.source === "reader").length, skipped });
  });
  return { ok: true, rules: found.filter((f) => f.source === "rule").length, reader: found.filter((f) => f.source === "reader").length, skipped, note };
}

export async function bidCheckScreen(pool: Pool, who: Who, eventId: string): Promise<CheckScreen | null> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  const base = await withTenant(pool, who.tenantId, async (c) => {
    const ev = (await c.query(`select state::text as state from sourcing_event where id = $1`, [eventId])).rows[0];
    if (!ev || !CHECKABLE.includes(ev.state) || !(await isBuyer(c, who, eventId))) return null;
    const sealed = (await readBidItems(c, actor(who), eventId)).length === 0;
    const names = new Map((await c.query(`select id, name from supplier_org`)).rows.map((r) => [r.id as string, r.name as string]));
    const rows = (await c.query(`select * from bid_check where event_id = $1 order by supplier_id, case severity when 'block' then 0 when 'warn' then 1 else 2 end, line_no nulls last, created_at`, [eventId])).rows;
    const cache = (await c.query(`select terms from bid_check_terms_cache where event_id = $1`, [eventId])).rows[0]?.terms as Record<string, Terms> | undefined;
    return { sealed, names, rows, cache: cache ?? {} };
  });
  if (!base) return null;
  const alias = await anonymousAliases(pool, who, eventId).catch(() => null);
  const nameOf = (id: string) => (alias ? alias.get(id) ?? "Bidder" : base.names.get(id) ?? "Supplier");
  const aiOn = (await claudeFor(pool, who.tenantId).catch(() => null)) !== null;
  const rows: CheckRow[] = base.rows.map((r) => ({ id: r.id, supplierId: r.supplier_id, supplier: nameOf(r.supplier_id), revisionNo: r.revision_no, source: r.source, kind: r.kind, severity: r.severity, lineNo: r.line_no, detail: r.detail, quote: r.quote, state: r.state }));
  const ids = [...new Set(rows.map((r) => r.supplierId))];
  return { canRun: true, sealed: base.sealed, aiOn, usage: aiOn ? await usageToday(pool, who.tenantId).catch(() => null) : null, rows, suppliers: ids.map((id) => ({ id, name: nameOf(id) })), terms: base.cache };
}

export async function dismissCheck(pool: Pool, who: Who, eventId: string, id: string): Promise<BOut> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: B_NOT_FOUND };
  return withTenant(pool, who.tenantId, async (c) => {
    if (!(await isBuyer(c, who, eventId))) return { ok: false as const, error: B_NO_ACCESS };
    const r = await c.query(`update bid_check set state = 'dismissed', decided_by = $3, decided_at = now() where id = $1 and event_id = $2 and state = 'open' returning kind`, [id, eventId, who.userId]);
    if (!r.rowCount) return { ok: false as const, error: B_NOT_FOUND };
    await audit(c, actor(who), eventId, "bidcheck.dismissed", { id, kind: r.rows[0].kind });
    return { ok: true as const };
  });
}

const SENTENCE: Record<string, (d: { line: number | null; quote: string | null }) => string> = {
  price_missing: (d) => `${d.line ? `Line ${d.line}` : "A line"} has no price. Please give a price, or confirm that you decline this line.`,
  currency: () => "Your prices are not in the currency of this event. Please confirm the prices in the event currency.",
  gate_declined: () => "You answered No to a mandatory declaration. Please confirm whether this is correct.",
  price_outlier: (d) => `Please confirm the unit price you gave for ${d.line ? `line ${d.line}` : "one line"}.`,
  exclusion: (d) => `You wrote "${d.quote}"${d.line ? ` (line ${d.line})` : ""}. Please confirm exactly what is not included, and whether the price covers it.`,
  deviation: (d) => `You wrote "${d.quote}"${d.line ? ` (line ${d.line})` : ""}. Please confirm how this differs from the requirement and whether you can meet the requirement.`,
  condition: (d) => `You wrote "${d.quote}"${d.line ? ` (line ${d.line})` : ""}. Please confirm whether this condition is firm.`,
  alternative: (d) => `You wrote "${d.quote}"${d.line ? ` (line ${d.line})` : ""}. Please confirm whether you also offer what was requested, and at what price.`,
  missing_info: (d) => `Your response does not clearly address a requirement${d.line ? ` on line ${d.line}` : ""}. Please confirm it.`,
  unclear: (d) => `You wrote "${d.quote}"${d.line ? ` (line ${d.line})` : ""}. Please clarify what you mean.`,
};
/** The message a supplier gets: fixed sentences per kind, with only the supplier's own quoted words added. Nothing written by the model is sent. */
export function clarificationText(ref: string, items: { kind: string; lineNo: number | null; quote: string | null }[]): string {
  const body = items.map((f, i) => `${i + 1}. ${SENTENCE[f.kind]!({ line: f.lineNo, quote: f.quote })}`).join("\n");
  return `Regarding your bid on ${ref}, please clarify the following points:\n${body}\n\nReply in this conversation by the date requested.`.slice(0, 4000);
}

/** The buyer sends the selected findings of one supplier as one private message with a reply deadline. Buyer confirms; nothing is sent automatically. */
export async function requestClarification(pool: Pool, who: Who, eventId: string, supplierId: string, checkIds: string[], days = 3): Promise<BOut<{ sent: number }>> {
  if (!Array.isArray(checkIds) || !checkIds.length || checkIds.length > 20 || !checkIds.every((x) => /^[0-9a-f-]{36}$/i.test(x))) return { ok: false, error: B_NOT_FOUND };
  const d = Math.min(Math.max(Math.trunc(days) || 3, 1), 30);
  const sel = await withTenant(pool, who.tenantId, async (c) => {
    if (!(await isBuyer(c, who, eventId))) return null;
    const ref = (await c.query(`select ref from sourcing_event where id = $1`, [eventId])).rows[0]?.ref as string | undefined;
    const rows = (await c.query(`select id, kind, line_no, quote from bid_check where event_id = $1 and supplier_id = $2 and state = 'open' and id = any($3::uuid[]) order by line_no nulls last, created_at`, [eventId, supplierId, checkIds])).rows;
    return ref ? { ref, rows } : null;
  });
  if (!sel) return { ok: false, error: B_NO_ACCESS };
  if (!sel.rows.length) return { ok: false, error: B_NOT_FOUND };
  const text = clarificationText(sel.ref, sel.rows.map((r) => ({ kind: r.kind, lineNo: r.line_no, quote: r.quote })));
  const sent = await staffReply(pool, who, eventId, supplierId, text, { requestDueAt: new Date(Date.now() + d * 86400000).toISOString(), decision: { keepPrivateReason: "Concerns only this supplier's own bid" } });
  if (!sent.ok) return { ok: false, error: sent.error };
  await withTenant(pool, who.tenantId, async (c) => {
    await c.query(`update bid_check set state = 'asked', decided_by = $3, decided_at = now() where event_id = $1 and id = any($2::uuid[])`, [eventId, sel.rows.map((r) => r.id), who.userId]);
    await audit(c, actor(who), eventId, "bidcheck.clarification_requested", { supplier: supplierId, findings: sel.rows.length });
  });
  return { ok: true, sent: sel.rows.length };
}
