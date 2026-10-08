import type { Pool, PoolClient } from "pg";
import { audit, withTenant } from "@/authz";
import { validate as validateEventInput, type EventSummary, type Who } from "@/events/service";
import { activeConfigRow, overridesFor, policiesOf, type TOut } from "./service";
import { resolve } from "./resolve";
import { buildSchedule, type Schedule, type TemplateInputs } from "./schedule";
import { applyPolicies, validateEffective } from "./validate";
import type { Effective, TemplateContent } from "./types";

const CAN_CREATE = new Set(["admin", "member"]);
export interface EventTemplateInfo { key: string; version: number; configVersion: number; hash: string; effective: Effective; inputs: TemplateInputs; values: Record<string, unknown>; schedule: Schedule; frozen: boolean }

export interface FromTemplateInput { templateKey: string; title: string; ownerDept?: string; closesAt?: string; inputs?: TemplateInputs; values?: Record<string, unknown>; idempotencyKey: string }

/** Creates a draft event from an enabled template: the effective configuration is resolved from the pinned versions and stored with the event. */
export async function createEventFromTemplate(pool: Pool, who: Who, input: FromTemplateInput): Promise<TOut<{ event: EventSummary; schedule: Schedule }>> {
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot create events." };
  const v = validateEventInput({ title: input.title, ownerDept: input.ownerDept, closesAt: input.closesAt });
  if (!v.ok) return v;
  if (!/^[\w-]{8,80}$/.test(input.idempotencyKey)) return { ok: false, error: "The request is not valid." };
  return withTenant(pool, who.tenantId, async (c) => {
    const again = (await c.query(`select id from sourcing_event where template_inputs->>'idempotencyKey' = $1`, [input.idempotencyKey])).rows[0];
    if (again) return { ok: true as const, event: await loadSummary(c, again.id), schedule: buildSchedule((await loadEffective(c, again.id))!.effective, input.inputs ?? { groups: {} }) };
    const cfg = await activeConfigRow(c);
    if (!cfg) return { ok: false as const, error: "Set up the company templates before creating an event from one." };
    const pin = (cfg.snapshot.templates as { key: string; version: number }[]).find((t) => t.key === input.templateKey);
    if (!pin) return { ok: false as const, error: "That template is not enabled for your company." };
    const tv = (await c.query(`select content, requires from template_version_published where template_key = $1 and version = $2`, [pin.key, pin.version])).rows[0];
    if (!tv) return { ok: false as const, error: "That template version is not available." };
    const overrides = await overridesFor(c, cfg.snapshot.overrides as string[], pin.key);
    const r0 = resolve(tv.content as TemplateContent, overrides); const pols = await policiesOf(c); const r = { ...r0, effective: applyPolicies(r0.effective, pols) };
    const chk = validateEffective(r.effective, { policies: pols, overrides, requires: tv.requires });
    if (chk.errors.length || r.problems.length) return { ok: false as const, error: "This template cannot be used right now.", issues: [...r.problems, ...chk.errors] };
    const prof = (await c.query(`select base_currency, default_language from company_profile`)).rows[0];
    const locale = prof?.default_language === "ar" ? "ar" : "en";
    const inputs: TemplateInputs = { groups: input.inputs?.groups ?? {}, include: input.inputs?.include ?? [] };
    const schedule = buildSchedule(r.effective, inputs, locale);
    const year = new Date().getUTCFullYear();
    const n = (await c.query(`insert into event_counter (tenant_id, year, last) values ($1,$2,1) on conflict (tenant_id, year) do update set last = event_counter.last + 1 returning last`, [who.tenantId, year])).rows[0].last as number;
    const ref = `EV-${year}-${String(n).padStart(3, "0")}`;
    const row = (await c.query(
      `insert into sourcing_event (tenant_id, title, ref, owner_dept, closes_at, created_by, currency, template_key, template_version, config_version, template_inputs, template_effective, template_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [who.tenantId, v.value.title, ref, v.value.ownerDept || null, v.value.closesAt, who.membershipId, prof?.base_currency || "AED", pin.key, pin.version, cfg.version,
        JSON.stringify({ ...inputs, values: input.values ?? {}, idempotencyKey: input.idempotencyKey }), JSON.stringify(r.effective), r.hash])).rows[0];
    await c.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1,$2,$3,'requester')`, [who.tenantId, row.id, who.membershipId]);
    await writeSchedule(c, who.tenantId, row.id, schedule);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, row.id, "event.created_from_template", { ref, template: pin.key, version: pin.version, config: cfg.version });
    return { ok: true as const, event: await loadSummary(c, row.id), schedule };
  });
}

async function loadSummary(c: PoolClient, id: string): Promise<EventSummary> {
  const r = (await c.query(`select id, ref, title, coalesce(owner_dept,'') as owner_dept, state::text as state, value_aed::text as value_aed, closes_at, currency, created_at from sourcing_event where id = $1`, [id])).rows[0];
  return { id: r.id, ref: r.ref, title: r.title, ownerDept: r.owner_dept, state: r.state, valueAed: r.value_aed ?? null, closesAt: r.closes_at ? new Date(r.closes_at).toISOString() : null, currency: r.currency, createdAt: new Date(r.created_at).toISOString() };
}

async function writeSchedule(c: PoolClient, tenantId: string, eventId: string, s: Schedule) {
  await c.query(`delete from event_item where event_id = $1 and template_line is not null`, [eventId]);
  let n = (await c.query(`select coalesce(max(line_no), 0) as n from event_item where event_id = $1`, [eventId])).rows[0].n as number;
  for (const it of s.items) {
    await c.query(`insert into event_item (tenant_id, event_id, line_no, description, quantity, unit, block_type, template_line) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId, eventId, ++n, it.description.slice(0, 500), it.quantity, it.unit, it.blockType, `${it.lineKey}:${it.rowIndex ?? 0}`]);
  }
}

async function loadEffective(c: PoolClient, eventId: string): Promise<{ effective: Effective; row: Record<string, unknown> } | null> {
  const r = (await c.query(`select template_effective, template_inputs, template_key, template_version, config_version, template_hash, template_frozen_at, state::text as state from sourcing_event where id = $1`, [eventId])).rows[0];
  return r?.template_effective ? { effective: r.template_effective as Effective, row: r } : null;
}

/** The template side of an event for the screens. Null when the event was not created from a template. */
export async function getEventTemplate(pool: Pool, who: Who, eventId: string): Promise<EventTemplateInfo | null> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  return withTenant(pool, who.tenantId, async (c) => {
    const e = await loadEffective(c, eventId);
    if (!e) return null;
    const inp = (e.row.template_inputs ?? {}) as TemplateInputs & { values?: Record<string, unknown> };
    const prof = (await c.query(`select default_language from company_profile`)).rows[0];
    const schedule = buildSchedule(e.effective, { groups: inp.groups ?? {}, include: inp.include ?? [] }, prof?.default_language === "ar" ? "ar" : "en");
    return { key: e.row.template_key as string, version: e.row.template_version as number, configVersion: e.row.config_version as number, hash: e.row.template_hash as string, effective: e.effective,
      inputs: { groups: inp.groups ?? {}, include: inp.include ?? [] }, values: inp.values ?? {}, schedule, frozen: Boolean(e.row.template_frozen_at) };
  });
}

/** Buyer changes the inputs (sites, headcount, days, optional lines). Template lines are rebuilt; lines the buyer added themselves are kept. Draft only. */
export async function updateTemplateInputs(pool: Pool, who: Who, eventId: string, inputs: TemplateInputs, values: Record<string, unknown>): Promise<TOut<{ schedule: Schedule }>> {
  if (!CAN_CREATE.has(who.role)) return { ok: false, error: "Your role cannot edit events." };
  return withTenant(pool, who.tenantId, async (c) => {
    const st = (await c.query(`select state::text as state, template_frozen_at from sourcing_event where id = $1 for update`, [eventId])).rows[0];
    if (!st) return { ok: false as const, error: "Event not found." };
    if (st.state !== "draft" || st.template_frozen_at) return { ok: false as const, error: "This event is no longer a draft, so its template inputs cannot be changed." };
    const e = await loadEffective(c, eventId);
    if (!e) return { ok: false as const, error: "This event was not created from a template." };
    const prof = (await c.query(`select default_language from company_profile`)).rows[0];
    const clean: TemplateInputs = { groups: inputs.groups ?? {}, include: inputs.include ?? [] };
    const schedule = buildSchedule(e.effective, clean, prof?.default_language === "ar" ? "ar" : "en");
    const old = (e.row.template_inputs ?? {}) as { idempotencyKey?: string };
    await c.query(`update sourcing_event set template_inputs = $2 where id = $1`, [eventId, JSON.stringify({ ...clean, values: values ?? {}, idempotencyKey: old.idempotencyKey })]);
    await writeSchedule(c, who.tenantId, eventId, schedule);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, eventId, "event.template_inputs_saved", { lines: schedule.items.length, incomplete: schedule.incomplete });
    return { ok: true as const, schedule };
  });
}

/** Blocks submission while the template inputs or required buyer details are incomplete. */
export async function templateProblem(c: PoolClient, eventId: string): Promise<string | null> {
  const e = await loadEffective(c, eventId);
  if (!e) return null;
  const inp = (e.row.template_inputs ?? {}) as TemplateInputs & { values?: Record<string, unknown> };
  const s = buildSchedule(e.effective, { groups: inp.groups ?? {}, include: inp.include ?? [] });
  if (s.incomplete) return "Complete the template inputs (sites, quantities and days) before submitting.";
  const missing = e.effective.fields.filter((f) => f.source === "buyer" && f.required === true && (inp.values?.[f.key] === undefined || inp.values[f.key] === "" || (Array.isArray(inp.values[f.key]) && (inp.values[f.key] as unknown[]).length === 0)));
  if (missing.length) return `Fill in the required event details before submitting: ${missing.map((f) => f.label.en).join(", ")}.`;
  return null;
}
/** Called once the event is submitted for publication: the issued configuration can no longer change. */
export async function freezeTemplate(c: PoolClient, eventId: string): Promise<void> {
  await c.query(`update sourcing_event set template_frozen_at = now() where id = $1 and template_key is not null and template_frozen_at is null`, [eventId]);
}
