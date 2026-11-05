import type { PoolClient } from "pg";

/**
 * How sealed envelopes are opened.
 *  witnessed: a different person (the witness) confirms, as before.
 *  buyer:     the event's buyer opens alone; the audit log records who and when.
 *  automatic: the system opens them by itself (when bidding closes, and when the technical result is approved).
 * Envelopes: "two" keeps technical and price apart; "single" opens both together and moves straight to price comparison.
 */
export type OpeningMode = "witnessed" | "buyer" | "automatic";
export interface OpeningPolicy {
  mode: OpeningMode;
  envelopes: "two" | "single";
  /** From this estimated value (AED) upwards, this mode applies instead of the base mode. */
  tiers?: { minValue: number; mode: OpeningMode }[];
}
export const OPENING_MODES: OpeningMode[] = ["witnessed", "buyer", "automatic"];
export const DEFAULT_OPENING: OpeningPolicy = { mode: "witnessed", envelopes: "two" };
/** The three steps that open envelopes. */
export const OPEN_COMMANDS = new Set(["OpenEnvelope1", "OpenEnvelope2", "OpenEnvelopesTogether"]);
const STRICT: Record<OpeningMode, number> = { witnessed: 3, buyer: 2, automatic: 1 };

const isMode = (m: unknown): m is OpeningMode => typeof m === "string" && (OPENING_MODES as string[]).includes(m);

/** Read a stored policy. Anything missing or unreadable falls back to the strict default, never to a looser one. */
export function cleanOpening(x: unknown): OpeningPolicy | undefined {
  const o = x as Partial<OpeningPolicy> | null | undefined;
  if (!o || typeof o !== "object") return undefined;
  const tiers = Array.isArray(o.tiers) ? o.tiers.filter((t) => t && isMode(t.mode) && Number.isFinite(Number(t.minValue))).map((t) => ({ minValue: Number(t.minValue), mode: t.mode })) : [];
  const p: OpeningPolicy = { mode: isMode(o.mode) ? o.mode : "witnessed", envelopes: o.envelopes === "single" ? "single" : "two", ...(tiers.length ? { tiers } : {}) };
  return p.mode === "witnessed" && p.envelopes === "two" && !p.tiers ? undefined : p;
}

export function validateOpening(o: OpeningPolicy | undefined): string | null {
  if (!o) return null;
  if (!isMode(o.mode)) return "Choose how envelopes are opened.";
  if (o.envelopes !== "two" && o.envelopes !== "single") return "Choose one or two envelopes.";
  const t = o.tiers ?? [];
  if (t.length > 4) return "Use at most 4 opening rules by value.";
  if (t.some((x) => !isMode(x.mode))) return "Each opening rule needs a mode.";
  if (t.some((x) => !Number.isInteger(x.minValue) || x.minValue < 0 || x.minValue > 1e12)) return "Each opening rule needs a whole amount of AED, 0 or more.";
  if (new Set(t.map((x) => x.minValue)).size !== t.length) return "Opening rule amounts must be different.";
  return null;
}

/** The mode for an event of this estimated value. An unknown value gets the strictest mode the company configured. */
export function modeFor(p: OpeningPolicy, valueAed: number | null): OpeningMode {
  const tiers = p.tiers ?? [];
  if (valueAed == null) return [p.mode, ...tiers.map((t) => t.mode)].sort((a, b) => STRICT[b] - STRICT[a])[0]!;
  let mode = p.mode, best = -1;
  for (const t of tiers) if (valueAed >= t.minValue && t.minValue > best) { mode = t.mode; best = t.minValue; }
  return mode;
}

/** The evaluation settings in force for an event: the copy frozen at publication, otherwise the latest saved version. */
export async function evaluationModel(c: PoolClient, eventId: string): Promise<{ model: Record<string, unknown> | null; valueAed: number | null }> {
  const ev = (await c.query(`select config_snapshot, value_aed::float8 as v from sourcing_event where id = $1`, [eventId])).rows[0];
  const snap = ev?.config_snapshot as { evaluation?: Record<string, unknown> } | null | undefined;
  const model = snap ? snap.evaluation ?? null : ((await c.query(`select model from tenant_config order by version desc limit 1`)).rows[0]?.model?.evaluation ?? null);
  return { model, valueAed: ev?.v ?? null };
}

export async function resolveOpening(c: PoolClient, eventId: string): Promise<{ mode: OpeningMode; envelopes: "two" | "single" }> {
  const { model, valueAed } = await evaluationModel(c, eventId);
  const p = cleanOpening(model?.opening) ?? DEFAULT_OPENING;
  return { mode: modeFor(p, valueAed), envelopes: p.envelopes };
}
