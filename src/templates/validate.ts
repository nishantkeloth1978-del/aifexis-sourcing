import { ExprError, parse, refs } from "./expr";
import { DEPLOYED_CAPABILITIES, CAPABILITY_LABEL, type Effective, type OverrideOp, type TemplateContent } from "./types";

export interface Issue { code: string; message: string; key: string; remediation?: string; where?: string }
export interface PolicyRule { key: string; kind: "require_document" | "require_question" | "require_field" | "note"; target: string; confirmed: boolean }
export type OverrideRow = OverrideOp & { templateKey?: string | null; scope: string };

const dupes = (keys: string[]) => keys.filter((k, i) => keys.indexOf(k) !== i);

/** Checks raw template content: duplicate keys, broken references, condition syntax, cycles, envelope leaks. */
export function validateContent(c: TemplateContent): Issue[] {
  const out: Issue[] = [];
  const add = (code: string, message: string, key: string, remediation?: string) => out.push({ code, message, key, ...(remediation ? { remediation } : {}) });
  const cols: [string, string[]][] = [["sections", c.sections.map((x) => x.key)], ["fields", c.fields.map((x) => x.key)], ["questions", c.questions.map((x) => x.key)], ["documents", c.documents.map((x) => x.key)],
    ["criteria", c.evaluation.criteria.map((x) => x.key)], ["lines", c.pricing.lines.map((x) => x.key)], ["groups", c.pricing.groups.map((x) => x.key)]];
  for (const [col, keys] of cols) for (const d of new Set(dupes(keys))) add("DUPLICATE_KEY", `The key "${d}" is used twice in ${col}.`, `${col}:${d}`, "Give each object its own stable key.");

  const sections = new Set(c.sections.map((s) => s.key));
  const known = new Map<string, "technical" | "commercial">();                    // keys a condition may refer to
  for (const f of c.fields) known.set(f.key, f.envelope);
  for (const q of c.questions) known.set(q.key, "technical");
  for (const g of c.pricing.groups) for (const i of g.inputs) known.set(i.key, "commercial");

  for (const f of c.fields) {
    if (!sections.has(f.section)) add("BROKEN_REFERENCE", `Field "${f.key}" is in section "${f.section}", which does not exist.`, `fields:${f.key}`);
    if ((f.type === "single" || f.type === "multi") && !f.options?.length) add("INVALID_FIELD", `Field "${f.key}" needs options.`, `fields:${f.key}`);
  }
  for (const q of c.questions) {
    if (!sections.has(q.section)) add("BROKEN_REFERENCE", `Question "${q.key}" is in section "${q.section}", which does not exist.`, `questions:${q.key}`);
    if ((q.type === "single" || q.type === "multi") && !q.options?.length) add("INVALID_FIELD", `Question "${q.key}" needs options.`, `questions:${q.key}`);
    if (q.use === "qualification" && q.type !== "yesno") add("INVALID_FIELD", `Qualification question "${q.key}" must be a Yes/No question.`, `questions:${q.key}`);
  }

  // conditions
  const deps = new Map<string, string[]>();
  const check = (cond: string | boolean | undefined, owner: string, env: "technical" | "commercial", scope: Set<string> | null) => {
    if (typeof cond !== "string") return;
    let ids: string[];
    try { ids = refs(parse(cond)); } catch (e) { add("INVALID_CONDITION", `${owner}: ${(e as ExprError).message}`, owner); return; }
    for (const id of ids) {
      if (!known.has(id) && !(scope && scope.has(id))) add("BROKEN_REFERENCE", `${owner} refers to "${id}", which does not exist.`, owner);
      else if (env === "technical" && known.get(id) === "commercial") add("ENVELOPE_LEAK", `${owner} depends on "${id}", which is commercial information, so it would reveal prices to technical evaluators.`, owner, "Base technical conditions on technical fields only.");
    }
    deps.set(owner, ids);
  };
  for (const f of c.fields) { check(f.required, `fields:${f.key}`, f.envelope, null); check(f.visible, `fields:${f.key}`, f.envelope, null); }
  for (const q of c.questions) check(q.required, `questions:${q.key}`, "technical", null);
  for (const d of c.documents) check(d.required, `documents:${d.key}`, d.envelope, null);
  const groupInputs = new Map(c.pricing.groups.map((g) => [g.key, new Set(["name", ...g.inputs.map((i) => i.key)])]));
  for (const l of c.pricing.lines) {
    const scope = l.group ? groupInputs.get(l.group) : new Set<string>();
    if (l.group && !scope) { add("BROKEN_REFERENCE", `Line "${l.key}" uses group "${l.group}", which does not exist.`, `lines:${l.key}`); continue; }
    try { for (const id of refs(parse(l.quantity))) if (!scope!.has(id)) add("BROKEN_REFERENCE", `Line "${l.key}" quantity uses "${id}", which is not an input of its group.`, `lines:${l.key}`); }
    catch (e) { add("INVALID_CONDITION", `lines:${l.key}: ${(e as ExprError).message}`, `lines:${l.key}`); }
    if (l.when) { try { for (const id of refs(parse(l.when))) if (!scope!.has(id)) add("BROKEN_REFERENCE", `Line "${l.key}" condition uses "${id}", which is not an input of its group.`, `lines:${l.key}`); } catch (e) { add("INVALID_CONDITION", `lines:${l.key}: ${(e as ExprError).message}`, `lines:${l.key}`); } }
  }
  // cycles between conditions: owner "fields:a" depends on "b"; "b" depends on "a"
  const state = new Map<string, 1 | 2>();
  const visit = (owner: string, path: string[]): void => {
    if (state.get(owner) === 2) return;
    if (state.get(owner) === 1) { add("CONDITION_CYCLE", `Conditions depend on each other in a loop: ${[...path, owner].join(" > ")}.`, owner, "Remove one of the conditions."); return; }
    state.set(owner, 1);
    for (const id of deps.get(owner) ?? []) for (const pre of ["fields", "questions"]) if (deps.has(`${pre}:${id}`)) visit(`${pre}:${id}`, [...path, owner]);
    state.set(owner, 2);
  };
  for (const o of deps.keys()) visit(o, []);
  const modes = new Set(c.evaluation.modes);
  if (!modes.has(c.evaluation.mode)) add("INVALID_EVALUATION", `The default evaluation mode "${c.evaluation.mode}" is not among the allowed modes.`, "evaluation:mode");
  if (c.evaluation.scale.max <= c.evaluation.scale.min) add("INVALID_EVALUATION", "The score scale must have a maximum above its minimum.", "evaluation:scale");
  return out;
}

/** Checks a resolved configuration against company policy, scoped overrides and what this deployment can run. */
export function validateEffective(e: Effective, ctx: { policies: PolicyRule[]; overrides?: OverrideRow[]; requires?: string[] }): { errors: Issue[]; unresolved: Issue[] } {
  const errors = validateContent(e);
  const unresolved: Issue[] = [];
  for (const cap of ctx.requires ?? []) if (!(DEPLOYED_CAPABILITIES as readonly string[]).includes(cap)) {
    errors.push({ code: "UNSUPPORTED_CAPABILITY", message: `This template needs "${CAPABILITY_LABEL[cap] ?? cap}", which this application does not support yet.`, key: `capability:${cap}`, remediation: "Use a template that does not need it, or wait until the capability is released." });
  }
  const find = (kind: PolicyRule["kind"], target: string) => kind === "require_document" ? e.documents.find((d) => d.key === target) : kind === "require_question" ? e.questions.find((q) => q.key === target) : e.fields.find((f) => f.key === target);
  for (const p of ctx.policies) {
    if (p.kind === "note") continue;
    if (!p.confirmed) { unresolved.push({ code: "POLICY_UNCONFIRMED", message: `Company policy "${p.key}" is not confirmed yet.`, key: `policy:${p.key}`, remediation: "Confirm the policy in company setup." }); continue; }
    const obj = find(p.kind, p.target);
    if (!obj) continue; // the policy only applies to templates that contain its target
    const req = "required" in obj ? obj.required : undefined;
    if (req === false || req === undefined) errors.push({ code: "POLICY_LOCKED", message: `Company policy "${p.key}" requires "${p.target}" to be mandatory.`, key: `policy:${p.key}`, remediation: "Make it mandatory again or ask a policy approver to change the policy." });
  }
  for (const o of ctx.overrides ?? []) { const b = overrideBreaksPolicy(o, ctx.policies); if (b) errors.push(b); }
  // scoped overrides: two on the same object with the same scope and no way to rank them
  const seen = new Map<string, string[]>();
  for (const o of ctx.overrides ?? []) { const k = `${o.templateKey ?? "*"}|${o.collection}:${o.objectKey}`; seen.set(k, [...(seen.get(k) ?? []), o.scope]); }
  for (const [k, scopes] of seen) for (const d of new Set(dupes(scopes))) errors.push({ code: "OVERRIDE_CONFLICT", message: `Two overrides on "${k.split("|")[1]}" use the same scope (${d}).`, key: k.split("|")[1]!, remediation: "Keep one override for each object and scope." });
  return { errors, unresolved };
}

/** Which required-document / question checks an override list would break, used when saving an override. */
export function overrideBreaksPolicy(op: OverrideOp, policies: PolicyRule[]): Issue | null {
  for (const p of policies) {
    if (!p.confirmed || p.kind === "note") continue;
    const col = p.kind === "require_document" ? "documents" : p.kind === "require_question" ? "questions" : "fields";
    if (op.collection !== col || op.objectKey !== p.target) continue;
    const weakens = op.op === "remove" || (op.op === "update" && op.value && "required" in op.value && op.value.required !== true && typeof op.value.required !== "string");
    if (weakens) return { code: "POLICY_LOCKED", message: `Company policy "${p.key}" locks "${p.target}" as mandatory.`, key: `policy:${p.key}`, remediation: "Ask a policy approver to change the policy first." };
  }
  return null;
}

/** Makes every confirmed require_* policy mandatory on the objects a template has. Returns the adjusted copy. */
export function applyPolicies<T extends Effective>(e: T, policies: PolicyRule[]): T {
  const out = JSON.parse(JSON.stringify(e)) as T;
  for (const p of policies) {
    if (!p.confirmed || p.kind === "note") continue;
    const list = (p.kind === "require_document" ? out.documents : p.kind === "require_question" ? out.questions : out.fields) as Array<{ key: string; required?: unknown }>;
    const o = list.find((x) => x.key === p.target);
    if (o) o.required = true;
  }
  return out;
}
