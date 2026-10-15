import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { withTenant } from "@/authz";
import { claudeFor } from "@/assistant/models";
import { complete, type AiDeps } from "@/messages/ai";

export const AGENT_DEFAULT_LIMIT = 50;
export const AG_NO_KEY = "AI drafting needs a Claude key. An administrator can add one under Configuration.";
export const AG_LIMIT = "The daily limit for AI drafts has been reached. Try again tomorrow or create the event by hand.";
export const AG_INVALID = "The AI could not produce a usable draft. Create the event by hand instead.";
export const AG_UNREACHABLE = "The AI service could not be used just now. Try again later or create the event by hand.";
export const AG_OFF = "AI proposals are switched off by the company's autonomy level. An administrator can change it under Configuration.";
export const AGENT_MESSAGES = [AG_NO_KEY, AG_LIMIT, AG_INVALID, AG_UNREACHABLE, AG_OFF];

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
export interface AgentSpec<T> { agent: "drafter" | "reader" | "recommender"; subjectType: "request" | "bid" | "event"; subjectId: string; system: string; user: string; maxTokens: number; parse: (raw: unknown) => Parsed<T> }
export type AgentOut<T> = { ok: true; runId: string; value: T } | { ok: false; error: string };

/** The JSON object in a model answer: plain, in a code fence, or with a sentence around it. Null if none parses. */
export function extractJson(text: string): unknown {
  const t = text.trim();
  const tries = [t, t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""), t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)];
  for (const x of tries) { try { const v = JSON.parse(x); if (v && typeof v === "object") return v; } catch { /* next */ } }
  return null;
}

export async function usageToday(pool: Pool, tenantId: string): Promise<{ used: number; limit: number }> {
  return withTenant(pool, tenantId, async (c) => {
    const used = (await c.query(`select count(*)::int n from agent_run where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`)).rows[0].n as number;
    const limit = ((await c.query(`select agent_daily_limit from autonomy_policy`)).rows[0]?.agent_daily_limit as number | undefined) ?? AGENT_DEFAULT_LIMIT;
    return { used, limit };
  });
}

/**
 * The one way an agent is called: Claude with the company's own key, a fixed prompt, a JSON answer checked against a schema, one retry on a bad answer,
 * a daily cap per company, and a stored record of the outcome. The result is a proposal; nothing here changes business data.
 */
export async function runAgent<T>(pool: Pool, who: { tenantId: string; userId: string }, spec: AgentSpec<T>, deps: AiDeps = {}): Promise<AgentOut<T>> {
  const level = await withTenant(pool, who.tenantId, async (c) => ((await c.query(`select level from autonomy_policy`)).rows[0]?.level as number | undefined) ?? 2);
  if (level < 2) return { ok: false, error: AG_OFF };
  const claude = deps.claude !== undefined ? deps.claude : await claudeFor(pool, who.tenantId).catch(() => null);
  if (!claude) return { ok: false, error: AG_NO_KEY };
  const { used, limit } = await usageToday(pool, who.tenantId);
  if (used >= limit) return { ok: false, error: AG_LIMIT };
  const digest = createHash("sha256").update(spec.system + "\n" + spec.user).digest("hex");
  let tin = 0, tout = 0, lastError = "invalid"; let value: T | undefined; let output: unknown = null; let reached = false;
  for (let attempt = 0; attempt < 2 && value === undefined; attempt++) {
    const user = attempt === 0 ? spec.user : `${spec.user}\n\nYour previous answer was rejected: ${lastError}. Answer again with only the corrected JSON object.`;
    const r = await complete(spec.system, user, spec.maxTokens, { ...deps, claude });
    if (!r.ok) { lastError = "service"; break; }
    reached = true; tin += r.usage?.in ?? 0; tout += r.usage?.out ?? 0;
    const raw = extractJson(r.text);
    if (raw === null) { lastError = "the answer was not a JSON object"; continue; }
    const p = spec.parse(raw);
    if (p.ok) { value = p.value; output = p.value; } else lastError = p.error;
  }
  const state = value !== undefined ? "proposed" : "failed";
  const id = await withTenant(pool, who.tenantId, async (c) => (await c.query(
    `insert into agent_run (tenant_id, agent, subject_type, subject_id, state, input_digest, output, error, model, tokens_in, tokens_out, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [who.tenantId, spec.agent, spec.subjectType, spec.subjectId, state, digest, output === null ? null : JSON.stringify(output), state === "failed" ? lastError.slice(0, 300) : null, claude.model, tin, tout, who.userId])).rows[0].id as string);
  if (value === undefined) return { ok: false, error: reached ? AG_INVALID : AG_UNREACHABLE };
  return { ok: true, runId: id, value };
}
