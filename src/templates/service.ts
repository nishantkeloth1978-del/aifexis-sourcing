import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { audit, withTenant } from "@/authz";
import type { Who } from "@/events/service";
import { resolve, hashOf } from "./resolve";
import { applyPolicies, overrideBreaksPolicy, validateEffective, type Issue, type OverrideRow, type PolicyRule } from "./validate";
import { DEPLOYED_CAPABILITIES, type Collection, type L, type OverrideOp, type TemplateContent, type TemplateMeta } from "./types";

export type TOut<T = object> = ({ ok: true } & T) | { ok: false; error: string; issues?: Issue[]; conflict?: boolean };
const ADMIN = new Set(["admin"]);
const err = (error: string, issues?: Issue[], conflict?: boolean): { ok: false; error: string; issues?: Issue[]; conflict?: boolean } => ({ ok: false, error, ...(issues ? { issues } : {}), ...(conflict ? { conflict } : {}) });

export { CURRENCIES } from "./consts";
import { CURRENCIES } from "./consts";
export const validZone = (z: string) => { try { new Intl.DateTimeFormat("en", { timeZone: z }); return z.includes("/") || z === "UTC"; } catch { return false; } };

export interface Industry { code: string; en: string; ar: string; availability: "pack" | "general" }
export interface Category { code: string; parent: string | null; en: string; ar: string }
export interface Profile {
  primaryIndustry: string | null; additionalIndustries: string[]; subsector: string; categories: string[]; country: string; locations: string[];
  currency: string; defaultLanguage: "en" | "ar"; languages: string[]; timeZone: string; departments: string[];
  status: "not_started" | "in_progress" | "gaps" | "ready"; version: number;
}
const EMPTY: Profile = { primaryIndustry: null, additionalIndustries: [], subsector: "", categories: [], country: "", locations: [], currency: "", defaultLanguage: "en", languages: ["en", "ar"], timeZone: "", departments: [], status: "not_started", version: 0 };

export async function listIndustries(pool: Pool, who: Who): Promise<Industry[]> {
  return withTenant(pool, who.tenantId, async (c) => (await c.query(`select code, label_en, label_ar, availability from industry order by label_en`)).rows.map((r) => ({ code: r.code, en: r.label_en, ar: r.label_ar, availability: r.availability })));
}
export async function listCategories(pool: Pool, who: Who): Promise<Category[]> {
  return withTenant(pool, who.tenantId, async (c) => (await c.query(`select code, parent_code, label_en, label_ar from purchase_category order by label_en`)).rows.map((r) => ({ code: r.code, parent: r.parent_code, en: r.label_en, ar: r.label_ar })));
}

const mapProfile = (r: Record<string, unknown>): Profile => ({
  primaryIndustry: (r.primary_industry as string | null) ?? null, additionalIndustries: r.additional_industries as string[], subsector: (r.subsector as string) ?? "", categories: r.categories as string[],
  country: (r.country as string) ?? "", locations: r.operating_locations as string[], currency: (r.base_currency as string) ?? "", defaultLanguage: r.default_language as "en" | "ar",
  languages: r.languages as string[], timeZone: (r.time_zone as string) ?? "", departments: r.departments as string[], status: r.status as Profile["status"], version: r.version as number,
});
export async function getProfile(pool: Pool, who: Who): Promise<Profile> {
  return withTenant(pool, who.tenantId, async (c) => { const r = (await c.query(`select * from company_profile`)).rows[0]; return r ? mapProfile(r) : EMPTY; });
}

const list = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))] : []);

/** Which setup items are still open. Standard templates can be drafted with gaps; "ready" needs all of these resolved. */
export function profileGaps(p: Profile, unconfirmedPolicies: number): string[] {
  const gaps: string[] = [];
  if (!p.primaryIndustry) gaps.push("Choose the primary industry.");
  if (!p.categories.length) gaps.push("Choose at least one purchasing category.");
  if (!p.country) gaps.push("Enter the country.");
  if (!p.currency) gaps.push("Choose the base currency.");
  if (!p.timeZone) gaps.push("Choose the time zone.");
  if (unconfirmedPolicies > 0) gaps.push("Confirm the company policies.");
  return gaps;
}

export interface ProfileInput { primaryIndustry: string | null; additionalIndustries?: string[]; subsector?: string; categories?: string[]; country?: string; locations?: string[]; currency?: string; defaultLanguage?: string; languages?: string[]; timeZone?: string; departments?: string[] }

/** Saves the company profile as a draft. A save against an older version is a conflict, never an overwrite. */
export async function saveProfile(pool: Pool, who: Who, input: ProfileInput, expectedVersion: number): Promise<TOut<{ profile: Profile; gaps: string[] }>> {
  if (!ADMIN.has(who.role)) return err("Only an administrator can change the company setup.");
  const primary = input.primaryIndustry || null;
  const additional = list(input.additionalIndustries).filter((x) => x !== primary);
  const categories = list(input.categories);
  const country = (input.country ?? "").trim().toUpperCase(), currency = (input.currency ?? "").trim().toUpperCase(), tz = (input.timeZone ?? "").trim();
  const langs = list(input.languages).filter((x) => x === "en" || x === "ar");
  const defLang = input.defaultLanguage === "ar" ? "ar" : "en";
  if (country && !/^[A-Z]{2}$/.test(country)) return err("Enter the country as a two-letter code, for example AE.");
  if (currency && !CURRENCIES.includes(currency)) return err("That currency is not supported.");
  if (tz && !validZone(tz)) return err("Enter a valid time zone name, for example Asia/Dubai.");
  if ((input.subsector ?? "").length > 120) return err("The subsector is too long (120 characters at most).");
  if (!langs.includes(defLang)) langs.push(defLang);
  return withTenant(pool, who.tenantId, async (c) => {
    const inds = new Set((await c.query(`select code from industry`)).rows.map((r) => r.code as string));
    if (primary && !inds.has(primary)) return err("That industry is not in the catalogue.");
    if (additional.some((x) => !inds.has(x))) return err("One of the additional industries is not in the catalogue.");
    const cats = new Set((await c.query(`select code from purchase_category`)).rows.map((r) => r.code as string));
    if (categories.some((x) => !cats.has(x))) return err("One of the purchasing categories is not in the catalogue.");
    const cur = (await c.query(`select version from company_profile for update`)).rows[0];
    if ((cur?.version ?? 0) !== expectedVersion) return err("The setup was changed by someone else. Reload and try again.", undefined, true);
    const row = { industry: primary, additional, subsector: (input.subsector ?? "").trim() || null, categories, country: country || null, locations: list(input.locations), currency: currency || null, defLang, langs, tz: tz || null, depts: list(input.departments) };
    const unconfirmed = (await c.query(`select count(*)::int n from company_policy where not confirmed`)).rows[0].n as number;
    const r = cur
      ? (await c.query(`update company_profile set primary_industry=$1, additional_industries=$2, subsector=$3, categories=$4, country=$5, operating_locations=$6, base_currency=$7, default_language=$8, languages=$9, time_zone=$10, departments=$11,
                          version = version + 1, updated_at = now(), updated_by = $12 where tenant_id = $13 returning *`,
          [row.industry, row.additional, row.subsector, row.categories, row.country, row.locations, row.currency, row.defLang, row.langs, row.tz, row.depts, who.membershipId, who.tenantId])).rows[0]
      : (await c.query(`insert into company_profile (tenant_id, primary_industry, additional_industries, subsector, categories, country, operating_locations, base_currency, default_language, languages, time_zone, departments, updated_by)
                          values ($13,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
          [row.industry, row.additional, row.subsector, row.categories, row.country, row.locations, row.currency, row.defLang, row.langs, row.tz, row.depts, who.membershipId, who.tenantId])).rows[0];
    const p = mapProfile(r);
    const gaps = profileGaps(p, unconfirmed);
    const active = (await c.query(`select 1 from company_config_version where status = 'active'`)).rowCount;
    const status = !active ? "in_progress" : gaps.length ? "gaps" : "ready";
    await c.query(`update company_profile set status = $1 where tenant_id = $2`, [status, who.tenantId]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "company.profile_saved", { version: p.version });
    return { ok: true as const, profile: { ...p, status }, gaps };
  });
}

// ---------- policies and overrides ----------
export interface Policy { key: string; kind: PolicyRule["kind"]; target: string; confirmed: boolean; note: string }
export async function listPolicies(pool: Pool, who: Who): Promise<Policy[]> {
  return withTenant(pool, who.tenantId, async (c) => (await c.query(`select key, kind, target, confirmed, coalesce(note,'') as note from company_policy order by key`)).rows as Policy[]);
}
export async function setPolicy(pool: Pool, who: Who, p: { key: string; kind: PolicyRule["kind"]; target: string; confirmed: boolean; note?: string }): Promise<TOut> {
  if (!ADMIN.has(who.role)) return err("Only an administrator can change company policies.");
  if (!/^[a-z0-9_-]{1,80}$/i.test(p.key) || !/^[a-z0-9_]{1,80}$/i.test(p.target)) return err("Use letters, digits, dashes and underscores for the policy key and target.");
  if (!["require_document", "require_question", "require_field", "note"].includes(p.kind)) return err("That policy type is not valid.");
  if ((p.note ?? "").length > 500) return err("The note is too long (500 characters at most).");
  return withTenant(pool, who.tenantId, async (c) => {
    await c.query(`insert into company_policy (tenant_id, key, kind, target, confirmed, confirmed_by, note) values ($1,$2,$3,$4,$5,$6,$7)
                   on conflict (tenant_id, key) do update set kind = excluded.kind, target = excluded.target, confirmed = excluded.confirmed, confirmed_by = excluded.confirmed_by, note = excluded.note`,
      [who.tenantId, p.key, p.kind, p.target, p.confirmed, p.confirmed ? who.membershipId : null, p.note ?? null]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "company.policy_set", { key: p.key, confirmed: p.confirmed });
    return { ok: true as const };
  });
}
export interface OverrideInput extends OverrideOp { templateKey?: string | null }
/** Stores a company override. It takes effect for new events once the configuration is activated again. */
export async function addOverride(pool: Pool, who: Who, input: OverrideInput): Promise<TOut<{ id: string }>> {
  if (!ADMIN.has(who.role)) return err("Only an administrator can customise templates.");
  return withTenant(pool, who.tenantId, async (c) => {
    const pol = await policiesOf(c);
    const broke = overrideBreaksPolicy(input, pol);
    if (broke) return err(broke.message, [broke]);
    const scope = input.scope ?? "company";
    if (scope !== "company" && !/^dept:.{1,80}$/.test(scope)) return err("The scope must be company or a department.");
    const r = await c.query(`insert into company_override (tenant_id, template_key, scope, collection, object_key, op, value, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [who.tenantId, input.templateKey ?? null, scope, input.collection, input.objectKey, input.op, input.value ? JSON.stringify(input.value) : null, who.membershipId]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "company.override_added", { collection: input.collection, objectKey: input.objectKey, op: input.op });
    return { ok: true as const, id: r.rows[0].id as string };
  });
}
async function policiesOf(c: PoolClient): Promise<PolicyRule[]> {
  return (await c.query(`select key, kind, target, confirmed from company_policy`)).rows as PolicyRule[];
}

// ---------- catalogue of templates ----------
export type Reason = { code: "pack_for_industry"; industry: string } | { code: "category_match"; category: string } | { code: "general" } | { code: "enabled_by_admin" };
export interface TemplateInfo extends TemplateMeta { version: number; packLabel: L | null; industryCodes: string[]; enabled: boolean; missing: string[]; reasons: Reason[] }

async function allTemplates(c: PoolClient): Promise<(TemplateInfo & { content: TemplateContent })[]> {
  const rows = (await c.query(
    `select d.*, p.label_en as pack_en, p.label_ar as pack_ar, p.industry_codes, v.version, v.content, v.requires
       from template_definition d left join industry_pack p on p.code = d.pack_code
       join lateral (select * from template_version_published v where v.template_key = d.key and v.status = 'published' order by v.version desc limit 1) v on true
      order by d.kind, d.title_en`)).rows;
  const enabled = new Map((await c.query(`select template_key, pinned_version from company_pack_assignment where enabled`)).rows.map((r) => [r.template_key as string, r.pinned_version as number]));
  return rows.map((r) => ({
    key: r.key, kind: r.kind, packCode: r.pack_code, categoryCode: r.category_code, eventType: r.event_type, method: r.method, pricingModel: r.pricing_model,
    title: { en: r.title_en, ar: r.title_ar }, summary: { en: r.summary_en, ar: r.summary_ar }, requires: r.requires, version: r.version,
    packLabel: r.pack_en ? { en: r.pack_en, ar: r.pack_ar } : null, industryCodes: r.industry_codes ?? [], enabled: enabled.has(r.key),
    missing: (r.requires as string[]).filter((x) => !(DEPLOYED_CAPABILITIES as readonly string[]).includes(x)), reasons: [], content: r.content as TemplateContent,
  }));
}

export async function listLibrary(pool: Pool, who: Who): Promise<TemplateInfo[]> {
  return withTenant(pool, who.tenantId, async (c) => (await allTemplates(c)).map(({ content: _c, ...t }) => t));
}

export interface Recommendation { templates: TemplateInfo[]; fallback: boolean; fallbackIndustry: string | null }
/** Packs for the company's industries, templates for its purchasing categories, and the general templates. Each carries its reason. */
export async function recommend(pool: Pool, who: Who): Promise<Recommendation> {
  return withTenant(pool, who.tenantId, async (c) => {
    const p = (await c.query(`select * from company_profile`)).rows[0];
    const prof = p ? mapProfile(p) : EMPTY;
    const all = await allTemplates(c);
    const inds = new Set([prof.primaryIndustry, ...prof.additionalIndustries].filter(Boolean) as string[]);
    const cats = (await c.query(`select code, parent_code from purchase_category`)).rows as { code: string; parent_code: string | null }[];
    const parentOf = new Map(cats.map((x) => [x.code, x.parent_code]));
    const chosen = new Set(prof.categories);
    const out: TemplateInfo[] = [];
    let anyPack = false;
    for (const t of all) {
      const reasons: Reason[] = [];
      if (t.kind === "general") reasons.push({ code: "general" });
      else {
        for (const ic of t.industryCodes) if (inds.has(ic)) { reasons.push({ code: "pack_for_industry", industry: ic }); anyPack = true; break; }
        let cat: string | null | undefined = t.categoryCode;
        while (cat) { if (chosen.has(cat)) { reasons.push({ code: "category_match", category: cat }); break; } cat = parentOf.get(cat); }
        if (!reasons.some((r) => r.code === "category_match") && chosen.has(t.categoryCode)) reasons.push({ code: "category_match", category: t.categoryCode });
      }
      if (reasons.length && !t.missing.length) { const { content: _c, ...rest } = t; out.push({ ...rest, reasons }); }
    }
    const hasDedicated = out.some((t) => t.kind === "scenario");
    return { templates: out, fallback: Boolean(prof.primaryIndustry) && !hasDedicated, fallbackIndustry: !hasDedicated ? prof.primaryIndustry : null };
  });
}

// ---------- activation ----------
export interface ConfigVersion { version: number; hash: string; createdAt: string; reason: string; templates: { key: string; version: number }[] }
export async function activeConfig(pool: Pool, who: Who): Promise<ConfigVersion | null> {
  return withTenant(pool, who.tenantId, async (c) => {
    const r = (await c.query(`select version, hash, created_at, reason, snapshot from company_config_version where status = 'active'`)).rows[0];
    return r ? { version: r.version, hash: r.hash, createdAt: new Date(r.created_at).toISOString(), reason: r.reason, templates: r.snapshot.templates } : null;
  });
}

async function overridesFor(c: PoolClient, ids: string[] | null, templateKey: string): Promise<OverrideRow[]> {
  const rows = (await c.query(`select id, template_key, scope, collection, object_key, op, value from company_override where (template_key is null or template_key = $1) ${ids ? "and id = any($2)" : ""} order by created_at, id`, ids ? [templateKey, ids] : [templateKey])).rows;
  return rows.map((r) => ({ id: r.id, templateKey: r.template_key, scope: r.scope, collection: r.collection as Collection, objectKey: r.object_key, op: r.op, value: r.value ?? undefined }));
}

/**
 * Enables exactly the selected templates (pinning their latest published versions) as one new company configuration.
 * Retrying with the same idempotency key returns the same result. If anything fails nothing changes and the previous configuration stays active.
 */
export async function activate(pool: Pool, who: Who, selection: string[], idempotencyKey: string, expectedVersion: number, reason = "", adopt: string[] = []): Promise<TOut<{ version: number; duplicate: boolean; added: string[]; removed: string[] }>> {
  if (!ADMIN.has(who.role)) return err("Only an administrator can activate the template library.");
  if (!/^[\w-]{8,80}$/.test(idempotencyKey)) return err("The request is not valid.");
  const keys = [...new Set(selection)];
  if (!keys.length) return err("Select at least one template.");
  return withTenant(pool, who.tenantId, async (c) => {
    await c.query(`select pg_advisory_xact_lock(hashtext($1))`, ["cfg:" + who.tenantId]);
    const prior = (await c.query(`select version, snapshot from company_config_version where idempotency_key = $1`, [idempotencyKey])).rows[0];
    if (prior) return { ok: true as const, version: prior.version, duplicate: true, added: [], removed: [] };
    const profile = (await c.query(`select * from company_profile`)).rows[0];
    if (!profile || !profile.primary_industry) return err("Save the company profile first.");
    const cur = (await c.query(`select version from company_config_version where status = 'active'`)).rows[0];
    if ((cur?.version ?? 0) !== expectedVersion) return err("The template configuration was changed by someone else. Reload and try again.", undefined, true);
    const all = new Map((await allTemplates(c)).map((t) => [t.key, t]));
    const pol = await policiesOf(c);
    const problems: Issue[] = [];
    const chosen: { key: string; version: number }[] = [];
    const pinned = new Map((await c.query(`select template_key, pinned_version from company_pack_assignment where enabled`)).rows.map((r) => [r.template_key as string, r.pinned_version as number]));
    for (const k of keys) {
      const t = all.get(k);
      if (!t) return err("One of the selected templates does not exist.");
      const overrides = await overridesFor(c, null, k);
      const useV = adopt.includes(k) || !pinned.has(k) ? t.version : pinned.get(k)!;
      const content = useV === t.version ? t.content : ((await c.query(`select content from template_version_published where template_key = $1 and version = $2`, [k, useV])).rows[0]?.content as TemplateContent);
      const r0 = resolve(content, overrides); const r = { ...r0, effective: applyPolicies(r0.effective, pol) };
      const v = validateEffective(r.effective, { policies: pol, overrides, requires: t.requires });
      problems.push(...r.problems.map((p) => ({ ...p })), ...v.errors.map((e) => ({ ...e, where: t.title.en })));
      chosen.push({ key: k, version: useV });
    }
    if (problems.length) return err("The selection cannot be activated.", problems);
    const before = new Set((await c.query(`select template_key from company_pack_assignment where enabled`)).rows.map((r) => r.template_key as string));
    for (const t of chosen) {
      await c.query(`insert into company_pack_assignment (tenant_id, template_key, pinned_version, source, enabled) values ($1,$2,$3,'recommended',true)
                     on conflict (tenant_id, template_key) do update set pinned_version = case when company_pack_assignment.enabled and $4::boolean is not true then company_pack_assignment.pinned_version else excluded.pinned_version end, enabled = true`,
        [who.tenantId, t.key, t.version, adopt.includes(t.key)]);
    }
    await c.query(`update company_pack_assignment set enabled = false where not (template_key = any($1))`, [keys]);
    const pins = (await c.query(`select template_key as key, pinned_version as version from company_pack_assignment where enabled order by template_key`)).rows as { key: string; version: number }[];
    const ovIds = (await c.query(`select id from company_override order by id`)).rows.map((r) => r.id as string);
    const snapshot = { templates: pins, overrides: ovIds, policies: pol.map((p) => `${p.key}:${p.confirmed}`).sort() };
    const next = (cur?.version ?? 0) + 1;
    await c.query(`update company_config_version set status = 'superseded' where status = 'active'`);
    await c.query(`insert into company_config_version (tenant_id, version, status, snapshot, hash, idempotency_key, reason, created_by) values ($1,$2,'active',$3,$4,$5,$6,$7)`,
      [who.tenantId, next, JSON.stringify(snapshot), hashOf(snapshot), idempotencyKey, reason.slice(0, 300), who.membershipId]);
    const unconfirmed = (await c.query(`select count(*)::int n from company_policy where not confirmed`)).rows[0].n as number;
    const status = profileGaps(mapProfile(profile), unconfirmed).length ? "gaps" : "ready";
    await c.query(`update company_profile set status = $1`, [status]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "company.config_activated", { version: next, templates: pins.map((p) => `${p.key}@${p.version}`) });
    return { ok: true as const, version: next, duplicate: false, added: keys.filter((k) => !before.has(k)), removed: [...before].filter((k) => !keys.includes(k)) };
  });
}

/** Preview of what a different selection would add and remove. */
export async function previewSelection(pool: Pool, who: Who, selection: string[]): Promise<{ add: string[]; remove: string[]; keep: string[] }> {
  return withTenant(pool, who.tenantId, async (c) => {
    const have = new Set((await c.query(`select template_key from company_pack_assignment where enabled`)).rows.map((r) => r.template_key as string));
    const sel = new Set(selection);
    return { add: [...sel].filter((k) => !have.has(k)), remove: [...have].filter((k) => !sel.has(k)), keep: [...have].filter((k) => sel.has(k)) };
  });
}

// ---------- matching ----------
export interface MatchInput { category: string; eventType: "RFI" | "RFQ" | "RFP"; method?: string; pricingModel?: string }
export interface Candidate { template: TemplateInfo; score: number; why: Reason[] }
export interface MatchResult { candidates: Candidate[]; ambiguous: boolean; fallback: boolean }

/**
 * Enabled templates only. Filter by event type, method and pricing structure; rank exact category over parent category over industry relevance;
 * the general template is the last resort. A tie at the top asks the buyer to choose between named candidates.
 */
export async function matchTemplate(pool: Pool, who: Who, input: MatchInput): Promise<MatchResult> {
  return withTenant(pool, who.tenantId, async (c) => {
    const all = (await allTemplates(c)).filter((t) => t.enabled && t.missing.length === 0);
    const prof = (await c.query(`select primary_industry, additional_industries from company_profile`)).rows[0];
    const inds = new Set([prof?.primary_industry, ...(prof?.additional_industries ?? [])].filter(Boolean) as string[]);
    const cats = (await c.query(`select code, parent_code from purchase_category`)).rows as { code: string; parent_code: string | null }[];
    const parentOf = new Map(cats.map((x) => [x.code, x.parent_code]));
    const chain: string[] = []; for (let x: string | null | undefined = input.category; x; x = parentOf.get(x)) chain.push(x);
    const out: Candidate[] = [];
    for (const t of all) {
      if (t.eventType !== input.eventType) continue;
      if (input.method && t.method !== input.method) continue;
      if (input.pricingModel && t.pricingModel !== input.pricingModel && t.pricingModel !== "mixed") continue;
      const why: Reason[] = []; let score = 0;
      const depth = chain.indexOf(t.categoryCode);
      if (t.kind === "scenario" && depth === 0) { score += 30; why.push({ code: "category_match", category: t.categoryCode }); }
      else if (t.kind === "scenario" && depth > 0) { score += 20; why.push({ code: "category_match", category: t.categoryCode }); }
      else if (t.kind === "general") { score += 1; why.push({ code: "general" }); }
      else continue;                                                                    // a scenario for another category is not a candidate
      if (t.kind === "scenario" && t.industryCodes.some((i) => inds.has(i))) { score += 5; why.push({ code: "pack_for_industry", industry: t.industryCodes.find((i) => inds.has(i))! }); }
      out.push({ template: (({ content: _c, ...r }) => r)(t) as TemplateInfo, score, why });
    }
    out.sort((a, b) => b.score - a.score || a.template.title.en.localeCompare(b.template.title.en));
    const top = out[0]?.score ?? 0;
    return { candidates: out, ambiguous: out.filter((x) => x.score === top).length > 1 && top > 1, fallback: out.length > 0 && top <= 1 };
  });
}

export const fingerprint = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
export async function activeConfigRow(c: PoolClient): Promise<{ version: number; snapshot: { templates: { key: string; version: number }[]; overrides: string[] } } | null> {
  const r = (await c.query(`select version, snapshot from company_config_version where status = 'active'`)).rows[0];
  return r ? { version: r.version, snapshot: r.snapshot } : null;
}
export { overridesFor, allTemplates, policiesOf };
