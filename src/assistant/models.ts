import type { Pool } from "pg";
import { withTenant, audit } from "@/authz";
import { can } from "@/access/permissions";
import type { Who } from "@/events/service";
import { callFree, type FreeConfig } from "./free";

/**
 * Which models the assistant may use. The company's administrator chooses a MODE, a free PROVIDER from a fixed list and model NAMES.
 * The address each provider is reached at is fixed here (an administrator cannot point company questions at an address of their own),
 * and API keys are never entered in the app: they are read from the server environment (Vercel) by name.
 */
export type Mode = "free_first" | "claude_only";
export type ProviderId = "auto" | "groq" | "openrouter" | "gemini" | "custom";
export interface Settings { mode: Mode; freeProvider: ProviderId; freeModel: string; claudeModel: string }
export const DEFAULT_SETTINGS: Settings = { mode: "free_first", freeProvider: "auto", freeModel: "", claudeModel: "" };
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5";

interface Provider { id: Exclude<ProviderId, "auto">; label: string; keyVar: string; baseUrl: string; defaultModel: string; note: string }
export const PROVIDERS: Provider[] = [
  { id: "groq", label: "Groq", keyVar: "GROQ_API_KEY", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile", note: "Fast, with a generous free allowance." },
  { id: "openrouter", label: "OpenRouter", keyVar: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "meta-llama/llama-3.3-70b-instruct:free", note: "One key for many models; free models vary in availability." },
  { id: "gemini", label: "Google Gemini", keyVar: "GEMINI_API_KEY", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-2.5-flash", note: "Good quality, but check its free-tier terms: free use may be used to improve Google products." },
  { id: "custom", label: "Server default (FREE_LLM_*)", keyVar: "FREE_LLM_API_KEY", baseUrl: "", defaultModel: "", note: "Any OpenAI-compatible service set up by whoever runs the server (FREE_LLM_BASE_URL, FREE_LLM_MODEL)." },
];
const AUTO_ORDER: Provider["id"][] = ["custom", "groq", "openrouter", "gemini"];

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;
export const cleanModel = (v: unknown): string | null => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? "" : MODEL_NAME.test(t) ? t : null; };

export const keySet = (p: Provider, env: NodeJS.ProcessEnv) => Boolean(env[p.keyVar]);
export interface ProviderStatus { id: ProviderId; label: string; keyVar: string; keySet: boolean; defaultModel: string; note: string }
export function providerStatus(env: NodeJS.ProcessEnv = process.env): ProviderStatus[] {
  return PROVIDERS.map((p) => ({ id: p.id, label: p.label, keyVar: p.keyVar, keySet: keySet(p, env), defaultModel: p.id === "custom" ? (env.FREE_LLM_MODEL ?? "") : p.defaultModel, note: p.note }));
}
export const anyFreeKey = (env: NodeJS.ProcessEnv = process.env) => env.ASSISTANT_FREE !== "off" && PROVIDERS.some((p) => keySet(p, env));

/** The free model to use for a company's how-to questions, or null (claude_only, switched off, or no provider has a key). */
export function freeFor(s: Settings, env: NodeJS.ProcessEnv = process.env): FreeConfig | null {
  if (s.mode === "claude_only" || env.ASSISTANT_FREE === "off") return null;
  const order = s.freeProvider === "auto" ? AUTO_ORDER : [s.freeProvider];
  for (const id of order) {
    const p = PROVIDERS.find((x) => x.id === id)!;
    const key = env[p.keyVar];
    if (!key) continue;
    if (p.id === "custom") return { key, baseUrl: (env.FREE_LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, ""), model: s.freeModel || env.FREE_LLM_MODEL || "llama-3.3-70b-versatile" };
    return { key, baseUrl: p.baseUrl, model: s.freeModel || p.defaultModel };
  }
  return null;
}
export const claudeModelFor = (s: Settings, env: NodeJS.ProcessEnv = process.env) => s.claudeModel || env.ASSISTANT_MODEL || env.AI_MODEL || DEFAULT_CLAUDE_MODEL;

export async function getSettings(pool: Pool, tenantId: string): Promise<Settings> {
  const r = (await withTenant(pool, tenantId, (c) => c.query(`select mode, free_provider, free_model, claude_model from assistant_setting`))).rows[0];
  return r ? { mode: r.mode, freeProvider: r.free_provider, freeModel: r.free_model, claudeModel: r.claude_model } : DEFAULT_SETTINGS;
}

export const M_NO_PERM = "Only an administrator can change the assistant's models.";
export const M_BAD_MODEL = "A model name may use letters, digits and . _ : / - only (100 characters at most).";
export const M_BAD_CHOICE = "That choice is not available.";
export const M_SAVE_FAILED = "That could not be saved. Try again.";
export const MODEL_MESSAGES = [M_NO_PERM, M_BAD_MODEL, M_BAD_CHOICE, M_SAVE_FAILED];

export type SaveResult = { ok: true; settings: Settings } | { ok: false; error: string };
export async function saveSettings(pool: Pool, who: Who, input: unknown): Promise<SaveResult> {
  if (!can(who, "config.manage")) return { ok: false, error: M_NO_PERM };
  const a = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const mode = a.mode, provider = a.freeProvider;
  if ((mode !== "free_first" && mode !== "claude_only") || !["auto", "groq", "openrouter", "gemini", "custom"].includes(String(provider))) return { ok: false, error: M_BAD_CHOICE };
  const freeModel = cleanModel(a.freeModel), claudeModel = cleanModel(a.claudeModel);
  if (freeModel === null || claudeModel === null) return { ok: false, error: M_BAD_MODEL };
  const s: Settings = { mode, freeProvider: provider as ProviderId, freeModel, claudeModel };
  await withTenant(pool, who.tenantId, async (c) => {
    await c.query(`insert into assistant_setting (tenant_id, mode, free_provider, free_model, claude_model, updated_by, updated_at) values ($1,$2,$3,$4,$5,$6, now())
                   on conflict (tenant_id) do update set mode = $2, free_provider = $3, free_model = $4, claude_model = $5, updated_by = $6, updated_at = now()`,
      [who.tenantId, s.mode, s.freeProvider, s.freeModel, s.claudeModel, who.membershipId]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "assistant.settings", s);
  });
  return { ok: true, settings: s };
}

export const T_OK = "The model answered.";
export const T_KEY = "The provider rejected the key. Check it in Vercel and redeploy.";
export const T_MODEL = "The provider does not know that model name.";
export const T_LIMIT = "The provider's free limit is reached. Try again later.";
export const T_NONE = "No key is set for this choice. Add it in Vercel and redeploy.";
export const T_DOWN = "The provider could not be reached or did not answer.";
export const TEST_MESSAGES = [T_OK, T_KEY, T_MODEL, T_LIMIT, T_NONE, T_DOWN];

/** One tiny request to the model a company has chosen, so an administrator can check a key and a model name at once. */
export async function testModel(pool: Pool, who: Who, which: "free" | "claude", deps: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}): Promise<{ ok: boolean; message: string }> {
  if (!can(who, "config.manage")) return { ok: false, message: M_NO_PERM };
  const env = deps.env ?? process.env, f = deps.fetch ?? fetch;
  const s = await getSettings(pool, who.tenantId);
  if (which === "free") {
    const cfg = freeFor({ ...s, mode: "free_first" }, env);
    if (!cfg) return { ok: false, message: T_NONE };
    const r = await callFree(f, cfg, "Reply with the single word OK.", "Connection check.", undefined, Date.now() + 10 * 60_000);
    if (r.ok || r.why === "escalate") return { ok: true, message: T_OK };
    return { ok: false, message: r.why === "http-401" || r.why === "http-403" ? T_KEY : r.why === "http-404" || r.why === "http-400" ? T_MODEL : r.why === "http-429" ? T_LIMIT : T_DOWN };
  }
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, message: T_NONE };
  try {
    const res = await f("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: claudeModelFor(s, env), max_tokens: 8, messages: [{ role: "user", content: "Reply with the single word OK." }] }) });
    if (res.ok) return { ok: true, message: T_OK };
    return { ok: false, message: res.status === 401 || res.status === 403 ? T_KEY : res.status === 404 || res.status === 400 ? T_MODEL : res.status === 429 ? T_LIMIT : T_DOWN };
  } catch { return { ok: false, message: T_DOWN }; }
}
