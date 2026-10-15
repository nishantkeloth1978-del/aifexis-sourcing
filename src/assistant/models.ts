import type { Pool } from "pg";
import { withTenant, audit } from "@/authz";
import { can } from "@/access/permissions";
import type { Who } from "@/events/service";
import { callFree, type FreeConfig } from "./free";
import { decryptKey, encryptKey, encryptionReady, type Env } from "./keys";

/**
 * Which models the assistant may use, and the API keys for them, chosen by each company's administrator on the Configuration screen.
 * Provider addresses are fixed here (a company cannot point its questions at an address of its own). Keys are encrypted (./keys), write-only,
 * and live only in the app: nothing about the assistant or any other AI feature is set in the server environment. The `env` parameters below let a
 * caller supply keys of its own (tests and scripts); the app itself passes none.
 */
export type Mode = "free_first" | "claude_only";
export type FreeId = "groq" | "openrouter" | "gemini";
export type ProviderId = FreeId | "claude";
export interface Settings { mode: Mode; order: FreeId[]; models: Partial<Record<ProviderId, string>>; dailyLimit: number }
export const DEFAULT_DAILY_LIMIT = 100;
export const DEFAULT_SETTINGS: Settings = { mode: "free_first", order: [], models: {}, dailyLimit: DEFAULT_DAILY_LIMIT };
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5";

export interface Provider { id: FreeId; label: string; keyVar: string; baseUrl: string; defaultModel: string; note: string }
export const PROVIDERS: Provider[] = [
  { id: "groq", label: "Groq", keyVar: "GROQ_API_KEY", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile", note: "Fast, with a generous free allowance." },
  { id: "openrouter", label: "OpenRouter", keyVar: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "meta-llama/llama-3.3-70b-instruct:free", note: "One key for many models; free models vary in availability." },
  { id: "gemini", label: "Google Gemini", keyVar: "GEMINI_API_KEY", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-2.5-flash", note: "Good quality, but check its free-tier terms: free use may be used to improve Google products." },
];
const FREE_IDS = PROVIDERS.map((p) => p.id);
const isFree = (v: unknown): v is FreeId => FREE_IDS.includes(v as FreeId);
const isProvider = (v: unknown): v is ProviderId => v === "claude" || isFree(v);

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;
export const cleanModel = (v: unknown): string | null => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? "" : MODEL_NAME.test(t) ? t : null; };
const KEY_CHARS = /^[\x21-\x7E]{8,300}$/;   // printable, no spaces

// ---------- what is stored ----------
interface KeyRow { provider: ProviderId; ciphertext: string; last4: string; addedBy: string; addedAt: string }
async function load(pool: Pool, tenantId: string): Promise<{ settings: Settings; claudeModel: string; keys: KeyRow[]; updatedAt: string | null }> {
  return withTenant(pool, tenantId, async (c) => {
    const s = (await c.query(`select mode, free_order, free_models, claude_model, daily_limit, updated_at from assistant_setting`)).rows[0];
    const keys = (await c.query(`select provider, ciphertext, last4, added_by, added_at from assistant_key`)).rows.map((r) => ({ provider: r.provider, ciphertext: r.ciphertext, last4: r.last4, addedBy: r.added_by, addedAt: new Date(r.added_at).toISOString() })) as KeyRow[];
    if (!s) return { settings: DEFAULT_SETTINGS, claudeModel: "", keys, updatedAt: null };
    const models: Settings["models"] = {};
    for (const [k, v] of Object.entries((s.free_models ?? {}) as Record<string, unknown>)) if (isFree(k) && typeof v === "string" && cleanModel(v)) models[k] = v;
    if (s.claude_model) models.claude = s.claude_model;
    return { settings: { mode: s.mode, order: (s.free_order as string[]).filter(isFree), models, dailyLimit: s.daily_limit }, claudeModel: s.claude_model, keys, updatedAt: new Date(s.updated_at).toISOString() };
  });
}
export const getSettings = async (pool: Pool, tenantId: string): Promise<Settings> => (await load(pool, tenantId)).settings;

// ---------- what the assistant runs on ----------
export interface Runtime { settings: Settings; free: FreeConfig[]; claude: { key: string; model: string } | null }

/** Free providers to try, in the company's order, then the server's own default service if one is set. Claude's key and model. */
export async function loadRuntime(pool: Pool, tenantId: string, env: Env = {}): Promise<Runtime> {
  const { settings, keys } = await load(pool, tenantId).catch(() => ({ settings: DEFAULT_SETTINGS, keys: [] as KeyRow[] }));
  const own = (id: ProviderId) => { const r = keys.find((k) => k.provider === id); return r ? decryptKey(r.ciphertext, tenantId, id, env) : null; };
  const free: FreeConfig[] = [];
  if (settings.mode !== "claude_only") {
    const order = [...settings.order, ...FREE_IDS.filter((i) => !settings.order.includes(i))];
    for (const id of order) {
      const p = PROVIDERS.find((x) => x.id === id)!;
      const key = own(id) || env[p.keyVar];
      if (key) free.push({ id, key, baseUrl: p.baseUrl, model: settings.models[id] || p.defaultModel });
    }
  }
  const ckey = own("claude") || env.ANTHROPIC_API_KEY;
  return { settings, free, claude: ckey ? { key: ckey, model: settings.models.claude || env.AI_MODEL || DEFAULT_CLAUDE_MODEL } : null };
}
/** The Claude key and model for any AI feature of a company, from its own settings; null when none has been entered. */
export async function claudeFor(pool: Pool, tenantId: string, env: Env = {}): Promise<{ key: string; model: string } | null> {
  return (await loadRuntime(pool, tenantId, env)).claude;
}
export async function aiEnabled(pool: Pool, tenantId: string, env: Env = {}): Promise<boolean> {
  return (await claudeFor(pool, tenantId, env)) !== null;
}
export async function assistantEnabled(pool: Pool, tenantId: string, env: Env = {}): Promise<boolean> {
  const rt = await loadRuntime(pool, tenantId, env);
  return Boolean(rt.claude || rt.free.length);
}

// ---------- the Configuration screen ----------
export interface Card { id: ProviderId; label: string; note: string; defaultModel: string; model: string; hasKey: boolean; last4: string; addedBy: string; addedAt: string }
export interface Screen { settings: Settings; cards: Card[]; encryption: boolean; updatedAt: string | null; usage: { free: number; claude: number; handedUp: number } }

export async function screenFor(pool: Pool, tenantId: string, env: Env = {}): Promise<Screen> {
  const { settings, keys, updatedAt } = await load(pool, tenantId);
  const card = (id: ProviderId, label: string, note: string, defaultModel: string): Card => {
    const k = keys.find((r) => r.provider === id);
    return { id, label, note, defaultModel, model: settings.models[id] ?? "", hasKey: Boolean(k), last4: k?.last4 ?? "", addedBy: k?.addedBy ?? "", addedAt: k?.addedAt ?? "" };
  };
  const cards = [...PROVIDERS.map((p) => card(p.id, p.label, p.note, p.defaultModel)), card("claude", "Claude (Anthropic)", "Used for your own data, for any change, and for the other AI features: drafting templates, message replies and translation, and evaluator suggestions.", DEFAULT_CLAUDE_MODEL)];
  const u = (await withTenant(pool, tenantId, (c) => c.query(
    `select count(*) filter (where provider like 'free%')::int free,
            count(*) filter (where provider in ('claude','claude:data','claude:no-free-key'))::int claude,
            count(*) filter (where provider like 'claude:free-%')::int handed
       from assistant_message where created_at >= date_trunc('month', now())`))).rows[0];
  return { settings, cards, encryption: encryptionReady(env), updatedAt, usage: { free: u.free, claude: u.claude, handedUp: u.handed } };
}

export const M_NO_PERM = "Only an administrator can change the assistant's models.";
export const M_BAD_MODEL = "A model name may use letters, digits and . _ : / - only (100 characters at most).";
export const M_BAD_CHOICE = "That choice is not available.";
export const M_SAVE_FAILED = "That could not be saved. Try again.";
export const M_BAD_LIMIT = "The daily limit must be a whole number from 1 to 5000.";
export const M_BAD_KEY = "A key is 8 to 300 characters with no spaces. Copy it again from the provider.";
export const M_NO_MASTER = "Keys cannot be stored: the server has no signing secret set. Contact whoever runs the server.";
export const MODEL_MESSAGES = [M_NO_PERM, M_BAD_MODEL, M_BAD_CHOICE, M_SAVE_FAILED, M_BAD_KEY, M_NO_MASTER, M_BAD_LIMIT];

export type SaveResult = { ok: true; settings: Settings } | { ok: false; error: string };
const actor = (who: Who) => ({ kind: "internal" as const, tenantId: who.tenantId, userId: who.userId });

export async function saveSettings(pool: Pool, who: Who, input: unknown): Promise<SaveResult> {
  if (!can(who, "config.manage")) return { ok: false, error: M_NO_PERM };
  const a = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const mode = a.mode;
  const dailyLimit = a.dailyLimit === undefined ? DEFAULT_DAILY_LIMIT : a.dailyLimit;
  if (typeof dailyLimit !== "number" || !Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 5000) return { ok: false, error: M_BAD_LIMIT };
  if ((mode !== "free_first" && mode !== "claude_only") || !Array.isArray(a.order) || a.order.length > 3 || !a.order.every(isFree) || new Set(a.order).size !== a.order.length) return { ok: false, error: M_BAD_CHOICE };
  const rawModels = (a.models && typeof a.models === "object" ? a.models : {}) as Record<string, unknown>;
  const models: Settings["models"] = {};
  for (const [k, v] of Object.entries(rawModels)) {
    if (!isProvider(k)) return { ok: false, error: M_BAD_CHOICE };
    const m = cleanModel(v); if (m === null) return { ok: false, error: M_BAD_MODEL };
    if (m) models[k] = m;
  }
  const s: Settings = { mode, order: a.order as FreeId[], models, dailyLimit };
  const freeModels = Object.fromEntries(Object.entries(models).filter(([k]) => k !== "claude"));
  await withTenant(pool, who.tenantId, async (c) => {
    await c.query(`insert into assistant_setting (tenant_id, mode, free_order, free_models, claude_model, daily_limit, updated_by, updated_at) values ($1,$2,$3,$4,$5,$6,$7, now())
                   on conflict (tenant_id) do update set mode = $2, free_order = $3, free_models = $4, claude_model = $5, daily_limit = $6, updated_by = $7, updated_at = now()`,
      [who.tenantId, s.mode, s.order, JSON.stringify(freeModels), models.claude ?? "", s.dailyLimit, who.membershipId]);
    await audit(c, actor(who), null, "assistant.settings", s);
  });
  return { ok: true, settings: s };
}

/** Stores a key encrypted. Replaces any key already stored for that provider. The key is never logged, returned or shown again. */
export async function setKey(pool: Pool, who: Who & { email?: string }, provider: unknown, key: unknown, env: Env = {}): Promise<{ ok: true; last4: string } | { ok: false; error: string }> {
  if (!can(who, "config.manage")) return { ok: false, error: M_NO_PERM };
  if (!isProvider(provider)) return { ok: false, error: M_BAD_CHOICE };
  const k = typeof key === "string" ? key.trim() : "";
  if (!KEY_CHARS.test(k)) return { ok: false, error: M_BAD_KEY };
  if (!encryptionReady(env)) return { ok: false, error: M_NO_MASTER };
  const blob = encryptKey(k, who.tenantId, provider, env), last4 = k.slice(-4), by = (who.email ?? "").slice(0, 120);
  await withTenant(pool, who.tenantId, async (c) => {
    await c.query(`insert into assistant_key (tenant_id, provider, ciphertext, last4, added_by, added_at) values ($1,$2,$3,$4,$5, now())
                   on conflict (tenant_id, provider) do update set ciphertext = $3, last4 = $4, added_by = $5, added_at = now()`, [who.tenantId, provider, blob, last4, by]);
    await audit(c, actor(who), null, "assistant.key.set", { provider });
  });
  return { ok: true, last4 };
}
export async function removeKey(pool: Pool, who: Who, provider: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!can(who, "config.manage")) return { ok: false, error: M_NO_PERM };
  if (!isProvider(provider)) return { ok: false, error: M_BAD_CHOICE };
  await withTenant(pool, who.tenantId, async (c) => {
    await c.query(`delete from assistant_key where provider = $1`, [provider]);
    await audit(c, actor(who), null, "assistant.key.removed", { provider });
  });
  return { ok: true };
}

export const T_OK = "The model answered.";
export const T_KEY = "The provider rejected the key. Check it and try again.";
export const T_MODEL = "The provider does not know that model name.";
export const T_LIMIT = "The provider's free limit is reached. Try again later.";
export const T_NONE = "No key is set for this provider.";
export const T_DOWN = "The provider could not be reached or did not answer.";
export const TEST_MESSAGES = [T_OK, T_KEY, T_MODEL, T_LIMIT, T_NONE, T_DOWN];
const byStatus = (n: number) => (n === 401 || n === 403 ? T_KEY : n === 404 || n === 400 ? T_MODEL : n === 429 ? T_LIMIT : T_DOWN);

/** One tiny request with the key and model name in force for that provider, so an administrator can check them at once. */
export async function testProvider(pool: Pool, who: Who, provider: unknown, deps: { env?: Env; fetch?: typeof fetch } = {}): Promise<{ ok: boolean; message: string }> {
  if (!can(who, "config.manage")) return { ok: false, message: M_NO_PERM };
  if (!isProvider(provider)) return { ok: false, message: M_BAD_CHOICE };
  const env = deps.env ?? {}, f = deps.fetch ?? fetch;
  if (provider === "claude") {
    const rt = await loadRuntime(pool, who.tenantId, env);
    if (!rt.claude) return { ok: false, message: T_NONE };
    try {
      const res = await f("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": rt.claude.key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: rt.claude.model, max_tokens: 8, messages: [{ role: "user", content: "Reply with the single word OK." }] }) });
      return res.ok ? { ok: true, message: T_OK } : { ok: false, message: byStatus(res.status) };
    } catch { return { ok: false, message: T_DOWN }; }
  }
  // Free providers are tested even when the mode is "Claude only", so a key can be checked before it is switched on.
  const cfg = await loadFreeFor(pool, who.tenantId, provider, env);
  if (!cfg) return { ok: false, message: T_NONE };
  const r = await callFree(f, cfg, "Reply with the single word OK.", "Connection check.", undefined, Date.now() + 10 * 60_000);
  if (r.ok || r.why === "escalate") return { ok: true, message: T_OK };
  return { ok: false, message: r.why.startsWith("http-") ? byStatus(Number(r.why.slice(5))) : T_DOWN };
}

/** The free configuration for one provider whatever the mode (used by the Test button). */
async function loadFreeFor(pool: Pool, tenantId: string, id: FreeId, env: Env): Promise<FreeConfig | null> {
  const { settings, keys } = await load(pool, tenantId);
  const p = PROVIDERS.find((x) => x.id === id)!;
  const row = keys.find((k) => k.provider === id);
  const key = (row ? decryptKey(row.ciphertext, tenantId, id, env) : null) || env[p.keyVar];
  return key ? { id, key, baseUrl: p.baseUrl, model: settings.models[id] || p.defaultModel } : null;
}
