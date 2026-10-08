import type { Pool } from "pg";
import { audit, withTenant } from "@/authz";
import type { Who } from "@/events/service";
import { hashOf, resolve } from "./resolve";
import { applyPolicies, validateEffective, type Issue } from "./validate";
import { allTemplates, overridesFor, policiesOf, type TOut } from "./service";
import type { L, TemplateContent } from "./types";

const ADMIN = new Set(["admin"]);
const err = (error: string, issues?: Issue[], conflict?: boolean): { ok: false; error: string; issues?: Issue[]; conflict?: boolean } => ({ ok: false, error, ...(issues ? { issues } : {}), ...(conflict ? { conflict } : {}) });

export interface Change { collection: string; key: string; label: L; kind: "added" | "removed" | "changed" }
const COLS = ["fields", "questions", "documents"] as const;
type Obj = { key: string; label?: L; description?: L };

/** What differs between two versions of a template, in terms a buyer recognises. */
export function diffContent(a: TemplateContent, b: TemplateContent): Change[] {
  const out: Change[] = [];
  const pick = (c: TemplateContent, col: string): Obj[] => (col === "lines" ? c.pricing.lines.map((l) => ({ ...l, label: l.description })) : (c as unknown as Record<string, Obj[]>)[col] ?? []);
  for (const col of [...COLS, "lines"]) {
    const x = new Map(pick(a, col).map((o) => [o.key, o])), y = new Map(pick(b, col).map((o) => [o.key, o]));
    for (const [k, o] of y) { if (!x.has(k)) out.push({ collection: col, key: k, label: o.label ?? { en: k, ar: k }, kind: "added" }); else if (JSON.stringify(x.get(k)) !== JSON.stringify(o)) out.push({ collection: col, key: k, label: o.label ?? { en: k, ar: k }, kind: "changed" }); }
    for (const [k, o] of x) if (!y.has(k)) out.push({ collection: col, key: k, label: o.label ?? { en: k, ar: k }, kind: "removed" });
  }
  const ca = a.evaluation.criteria.map((c) => c.key).join(), cb = b.evaluation.criteria.map((c) => c.key).join();
  if (ca !== cb) out.push({ collection: "criteria", key: "criteria", label: { en: "Evaluation criteria", ar: "معايير التقييم" }, kind: "changed" });
  return out;
}

export interface Update { key: string; title: L; pinned: number; latest: number; changes: Change[] }
/** Enabled templates that have a newer published version, with what would change. Events already created are never affected. */
export async function listUpdates(pool: Pool, who: Who): Promise<Update[]> {
  return withTenant(pool, who.tenantId, async (c) => {
    const pins = (await c.query(`select template_key, pinned_version from company_pack_assignment where enabled`)).rows as { template_key: string; pinned_version: number }[];
    const all = new Map((await allTemplates(c)).map((t) => [t.key, t]));
    const out: Update[] = [];
    for (const p of pins) {
      const t = all.get(p.template_key);
      if (!t || t.version <= p.pinned_version) continue;
      const old = (await c.query(`select content from template_catalog_versions where template_key = $1 and version = $2`, [p.template_key, p.pinned_version])).rows[0]?.content as TemplateContent | undefined;
      out.push({ key: t.key, title: t.title, pinned: p.pinned_version, latest: t.version, changes: old ? diffContent(old, t.content) : [] });
    }
    return out;
  });
}

export interface Historic { version: number; status: "active" | "superseded"; reason: string; createdAt: string; templates: { key: string; version: number }[] }
export async function configHistory(pool: Pool, who: Who): Promise<Historic[]> {
  return withTenant(pool, who.tenantId, async (c) =>
    (await c.query(`select version, status, reason, created_at, snapshot from company_config_version order by version desc limit 50`)).rows.map((r) => ({ version: r.version, status: r.status, reason: r.reason, createdAt: new Date(r.created_at).toISOString(), templates: r.snapshot.templates })));
}

/**
 * Makes an earlier configuration the active one again, as a new version (history is never rewritten).
 * The template versions and company overrides it pinned are restored; it is checked against today's company policies first.
 */
export async function rollbackTo(pool: Pool, who: Who, version: number, idempotencyKey: string, expectedVersion: number): Promise<TOut<{ version: number; duplicate: boolean }>> {
  if (!ADMIN.has(who.role)) return err("Only an administrator can activate the template library.");
  if (!/^[\w-]{8,80}$/.test(idempotencyKey) || !Number.isInteger(version)) return err("The request is not valid.");
  return withTenant(pool, who.tenantId, async (c) => {
    await c.query(`select pg_advisory_xact_lock(hashtext($1))`, ["cfg:" + who.tenantId]);
    const prior = (await c.query(`select version from company_config_version where idempotency_key = $1`, [idempotencyKey])).rows[0];
    if (prior) return { ok: true as const, version: prior.version, duplicate: true };
    const cur = (await c.query(`select version from company_config_version where status = 'active'`)).rows[0];
    if ((cur?.version ?? 0) !== expectedVersion) return err("The template configuration was changed by someone else. Reload and try again.", undefined, true);
    const old = (await c.query(`select snapshot from company_config_version where version = $1`, [version])).rows[0];
    if (!old) return err("That configuration version does not exist.");
    if (version === cur?.version) return err("That configuration is already active.");
    const snap = old.snapshot as { templates: { key: string; version: number }[]; overrides: string[]; policies?: string[] };
    const pol = await policiesOf(c);
    const problems: Issue[] = [];
    for (const t of snap.templates) {
      const tv = (await c.query(`select content, requires from template_catalog_versions where template_key = $1 and version = $2`, [t.key, t.version])).rows[0];
      if (!tv) return err("A template version in that configuration is no longer available.");
      const ovs = await overridesFor(c, snap.overrides, t.key);
      const r0 = resolve(tv.content as TemplateContent, ovs);
      const v = validateEffective(applyPolicies(r0.effective, pol), { policies: pol, overrides: ovs, requires: tv.requires });
      problems.push(...r0.problems, ...v.errors.map((e) => ({ ...e, where: t.key })));
    }
    if (problems.length) return err("The selection cannot be activated.", problems);
    await c.query(`update company_pack_assignment set enabled = false`);
    for (const t of snap.templates) {
      await c.query(`insert into company_pack_assignment (tenant_id, template_key, pinned_version, source, enabled) values ($1,$2,$3,'recommended',true)
                     on conflict (tenant_id, template_key) do update set pinned_version = excluded.pinned_version, enabled = true`, [who.tenantId, t.key, t.version]);
    }
    const next = (cur?.version ?? 0) + 1;
    const snapshot = { ...snap, policies: pol.map((p) => `${p.key}:${p.confirmed}`).sort() };
    await c.query(`update company_config_version set status = 'superseded' where status = 'active'`);
    await c.query(`insert into company_config_version (tenant_id, version, status, snapshot, hash, idempotency_key, reason, created_by) values ($1,$2,'active',$3,$4,$5,$6,$7)`,
      [who.tenantId, next, JSON.stringify(snapshot), hashOf(snapshot), idempotencyKey, `Rollback to version ${version}`, who.membershipId]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "company.config_rolled_back", { from: cur?.version ?? 0, to: version, version: next });
    return { ok: true as const, version: next, duplicate: false };
  });
}

export interface OverrideRowInfo { id: string; templateKey: string | null; scope: string; collection: string; objectKey: string; op: string; value: Record<string, unknown> | null; createdAt: string }
export async function listOverrides(pool: Pool, who: Who, templateKey?: string): Promise<OverrideRowInfo[]> {
  return withTenant(pool, who.tenantId, async (c) =>
    (await c.query(`select id, template_key, scope, collection, object_key, op, value, created_at from company_override ${templateKey ? "where template_key = $1 or template_key is null" : ""} order by created_at, id`, templateKey ? [templateKey] : []))
      .rows.map((r) => ({ id: r.id, templateKey: r.template_key, scope: r.scope, collection: r.collection, objectKey: r.object_key, op: r.op, value: r.value, createdAt: new Date(r.created_at).toISOString() })));
}
/** Removing an override takes effect for new events once the configuration is activated again. */
export async function removeOverride(pool: Pool, who: Who, id: string): Promise<TOut> {
  if (!ADMIN.has(who.role)) return err("Only an administrator can customise templates.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return err("The request is not valid.");
  return withTenant(pool, who.tenantId, async (c) => {
    const n = (await c.query(`delete from company_override where id = $1`, [id])).rowCount;
    if (!n) return err("That customisation was not found.");
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "company.override_removed", { id });
    return { ok: true as const };
  });
}

/** The template as this company's events would see it: platform content, then company overrides, then policies. */
export async function previewEffective(pool: Pool, who: Who, templateKey: string) {
  return withTenant(pool, who.tenantId, async (c) => {
    const t = (await allTemplates(c)).find((x) => x.key === templateKey);
    if (!t) return null;
    const pin = (await c.query(`select pinned_version from company_pack_assignment where template_key = $1 and enabled`, [templateKey])).rows[0]?.pinned_version as number | undefined;
    const content = pin && pin !== t.version ? ((await c.query(`select content from template_catalog_versions where template_key = $1 and version = $2`, [templateKey, pin])).rows[0]?.content as TemplateContent) : t.content;
    const overrides = await overridesFor(c, null, templateKey);
    const r = resolve(content, overrides);
    return { info: (({ content: _c, ...i }) => i)(t), version: pin ?? t.version, effective: applyPolicies(r.effective, await policiesOf(c)), problems: r.problems, hash: r.hash };
  });
}
