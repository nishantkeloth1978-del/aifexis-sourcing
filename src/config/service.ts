import type { Pool, PoolClient } from "pg";
import { audit, withTenant } from "@/authz";
import type { Who } from "@/events/service";

/** How events in this organisation are evaluated. A copy is frozen into each event when it is published. */
export interface EvalConfig {
  criteria: string[];                                   // technical criteria, each scored 0 to 10
  weights: { technical: number; commercial: number };   // whole percentages that add up to 100
  qualifyAt: number;                                    // suggested technical pass mark, out of 100
  closeMargin: number;                                  // top two final scores closer than this raise a warning
  criterionWeights?: number[];                          // whole percentages per criterion (same order), adding up to 100; equal when absent
  knockout?: string[];                                  // declarations where answering No disqualifies the bidder
  approval?: { publicationThreshold?: number; awardTiers?: { minValue: number; approvals: number }[] };   // by estimated value in AED
  gates?: string[];                                     // mandatory yes/no declarations every bidder must answer
}
export const DEFAULT_CONFIG: EvalConfig = {
  criteria: ["Compliance with specification", "Delivery and project plan", "Experience and references", "Warranty and support"],
  weights: { technical: 30, commercial: 70 }, qualifyAt: 70, closeMargin: 2,
};
export type CfgOut<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function cleanApproval(a: NonNullable<EvalConfig["approval"]>): NonNullable<EvalConfig["approval"]> {
  const out: NonNullable<EvalConfig["approval"]> = {};
  if (a.publicationThreshold != null && Number.isFinite(Number(a.publicationThreshold))) out.publicationThreshold = Number(a.publicationThreshold);
  if (Array.isArray(a.awardTiers) && a.awardTiers.length) out.awardTiers = a.awardTiers.map((t) => ({ minValue: Number(t.minValue), approvals: Number(t.approvals) }));
  return out;
}
export function clean(input: unknown): EvalConfig | null {
  const m = input as Partial<EvalConfig> | null | undefined;
  if (!m || !Array.isArray(m.criteria) || !m.weights) return null;
  return { criteria: m.criteria.map(String), weights: { technical: Number(m.weights.technical), commercial: Number(m.weights.commercial) }, qualifyAt: Number(m.qualifyAt), closeMargin: Number(m.closeMargin), ...(Array.isArray(m.gates) ? { gates: m.gates.map(String) } : {}), ...(Array.isArray(m.criterionWeights) ? { criterionWeights: m.criterionWeights.map(Number) } : {}), ...(m.approval && typeof m.approval === "object" ? { approval: cleanApproval(m.approval) } : {}), ...(Array.isArray(m.knockout) && m.knockout.length ? { knockout: m.knockout.map(String) } : {}) };
}

/** The configuration in force for an event: the frozen copy once published, otherwise the latest saved version. */
export async function resolveConfig(c: PoolClient, eventId?: string): Promise<EvalConfig> {
  const base = await baseConfig(c, eventId);
  return eventId ? overlayTemplate(c, base, eventId) : base;
}
async function baseConfig(c: PoolClient, eventId?: string): Promise<EvalConfig> {
  if (eventId) {
    const snap = (await c.query(`select config_snapshot from sourcing_event where id = $1`, [eventId])).rows[0]?.config_snapshot;
    if (snap) return clean(snap.evaluation) ?? DEFAULT_CONFIG;
  }
  const row = (await c.query(`select model from tenant_config order by version desc limit 1`)).rows[0];
  return clean(row?.model?.evaluation) ?? DEFAULT_CONFIG;
}

/**
 * An event created from a template brings its own technical criteria and Yes/No qualification questions (as declarations).
 * Weights, thresholds and approval tiers always stay with the company configuration: a template never sets them.
 * Criterion weights are kept only when the number of criteria is unchanged.
 */
async function overlayTemplate(c: PoolClient, cfg: EvalConfig, eventId: string): Promise<EvalConfig> {
  const eff = (await c.query(`select template_effective from sourcing_event where id = $1`, [eventId])).rows[0]?.template_effective as
    { evaluation?: { criteria?: { label?: { en?: string } }[] }; questions?: { use?: string; type?: string; label?: { en?: string } }[] } | null | undefined;
  if (!eff) return cfg;
  const out: EvalConfig = { ...cfg };
  const crit = (eff.evaluation?.criteria ?? []).map((k) => String(k.label?.en ?? "").trim()).filter(Boolean).slice(0, 8);
  if (crit.length) { out.criteria = crit; if (cfg.criterionWeights?.length !== crit.length) delete out.criterionWeights; }
  const gates = (eff.questions ?? []).filter((q) => q.use === "qualification" && q.type === "yesno").map((q) => String(q.label?.en ?? "").trim()).filter((g) => g.length >= 3 && g.length <= 120).slice(0, 8);
  if (gates.length) { out.gates = [...new Set([...(cfg.gates ?? []), ...gates])].slice(0, 8); }
  if (out.knockout) out.knockout = out.knockout.filter((k) => (out.gates ?? []).includes(k));
  return out;
}

export async function getConfig(pool: Pool, who: Who): Promise<{ config: EvalConfig; version: number }> {
  return withTenant(pool, who.tenantId, async (c) => {
    const row = (await c.query(`select version from tenant_config order by version desc limit 1`)).rows[0];
    return { config: await resolveConfig(c), version: row?.version ?? 0 };
  });
}

export function validateConfig(input: EvalConfig): string | null {
  const names = input.criteria.map((s) => s.trim());
  if (names.length < 1 || names.length > 8) return "Use between 1 and 8 technical criteria.";
  if (names.some((n) => n.length < 2 || n.length > 80)) return "Each criterion needs a name of 2 to 80 characters.";
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return "Criterion names must be different.";
  const { technical: t, commercial: k } = input.weights;
  if (![t, k].every((n) => Number.isInteger(n) && n >= 0 && n <= 100)) return "Weights must be whole percentages.";
  if (t + k !== 100) return "The technical and commercial weights must add up to 100.";
  if (!Number.isInteger(input.qualifyAt) || input.qualifyAt < 0 || input.qualifyAt > 100) return "The pass mark must be a whole number from 0 to 100.";
  if (!(input.closeMargin >= 0 && input.closeMargin <= 20) || Math.round(input.closeMargin * 10) !== input.closeMargin * 10) return "The close-result margin must be from 0 to 20 points.";
  if (input.criterionWeights) {
    const w = input.criterionWeights;
    if (w.length !== names.length) return "Give every criterion a weight.";
    if (!w.every((n) => Number.isInteger(n) && n >= 0 && n <= 100)) return "Criterion weights must be whole percentages.";
    if (w.reduce((a, b) => a + b, 0) !== 100) return "The criterion weights must add up to 100.";
  }
  const ap = input.approval;
  if (ap?.publicationThreshold != null && !(Number.isInteger(ap.publicationThreshold) && ap.publicationThreshold >= 0 && ap.publicationThreshold <= 1e12)) return "The publication threshold must be a whole amount of AED, 0 or more.";
  if (ap?.awardTiers) {
    const t = ap.awardTiers;
    if (t.length > 5) return "Use at most 5 award approval tiers.";
    if (t.some((x) => !Number.isInteger(x.minValue) || x.minValue < 0 || x.minValue > 1e12)) return "Each tier needs a whole amount of AED, 0 or more.";
    if (t.some((x) => !Number.isInteger(x.approvals) || x.approvals < 1 || x.approvals > 5)) return "Each tier needs 1 to 5 approvals.";
    if (new Set(t.map((x) => x.minValue)).size !== t.length) return "Tier amounts must be different.";
  }
  const gates = (input.gates ?? []).map((g) => g.trim());
  if ((input.knockout ?? []).some((k) => !gates.includes(k.trim()))) return "A disqualifying declaration must be one of the declarations.";
  if (gates.length > 8) return "Use at most 8 mandatory declarations.";
  if (gates.some((g) => g.length < 3 || g.length > 120)) return "Each declaration needs 3 to 120 characters.";
  if (new Set(gates.map((g) => g.toLowerCase())).size !== gates.length) return "Declarations must be different.";
  return null;
}

/** Saves a new version. Events already published keep the version they were published with. */
export async function saveConfig(pool: Pool, who: Who, input: EvalConfig): Promise<CfgOut<{ version: number }>> {
  if (who.role !== "admin") return { ok: false, error: "Only an administrator can change the configuration." };
  const cfg: EvalConfig = { ...input, criteria: input.criteria.map((s) => s.trim()), gates: (input.gates ?? []).map((s) => s.trim()) };
  if (!cfg.criterionWeights) delete cfg.criterionWeights;
  cfg.knockout = (cfg.knockout ?? []).map((s) => s.trim());
  if (!cfg.knockout.length) delete cfg.knockout;
  if (cfg.approval && cfg.approval.publicationThreshold == null && !cfg.approval.awardTiers?.length) delete cfg.approval;
  else if (cfg.approval) { if (cfg.approval.publicationThreshold == null) delete cfg.approval.publicationThreshold; if (!cfg.approval.awardTiers?.length) delete cfg.approval.awardTiers; else cfg.approval.awardTiers = [...cfg.approval.awardTiers].sort((a, b) => a.minValue - b.minValue); }
  const err = validateConfig(cfg);
  if (err) return { ok: false, error: err };
  return withTenant(pool, who.tenantId, async (c) => {
    const last = (await c.query(`select version, model from tenant_config order by version desc limit 1 for update`)).rows[0];
    const version = (last?.version ?? 0) + 1;
    await c.query(`insert into tenant_config (tenant_id, version, model) values ($1, $2, $3)`, [who.tenantId, version, JSON.stringify({ ...(last?.model ?? {}), evaluation: cfg })]);
    await audit(c, { kind: "internal", userId: who.userId, tenantId: who.tenantId }, null, "config.saved", { version });
    return { ok: true as const, version };
  });
}

/** Names of declarations a bidder answered No to (or left out) where a No disqualifies. */
export function failedKnockouts(cfg: EvalConfig, answers: { name: string; answer: boolean }[] | undefined): string[] {
  const given = new Map((answers ?? []).map((g) => [g.name, g.answer]));
  return (cfg.knockout ?? []).filter((k) => given.get(k) !== true);
}

/** What the approval policy says for an event of this estimated value. No value, or no policy, means a separate approver and one award approval. */
export function policyFor(cfg: EvalConfig, valueAed: number | null): { autoPublish: boolean; awardApprovals: number } {
  const a = cfg.approval;
  const autoPublish = a?.publicationThreshold != null && valueAed != null && valueAed < a.publicationThreshold;
  let awardApprovals = 1;
  if (valueAed != null) for (const t of a?.awardTiers ?? []) if (valueAed >= t.minValue) awardApprovals = Math.max(awardApprovals, t.approvals);
  return { autoPublish, awardApprovals };
}
