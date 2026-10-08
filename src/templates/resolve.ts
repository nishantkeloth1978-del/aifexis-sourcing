import { createHash } from "node:crypto";
import { SEC } from "./packs/common";
import { COLLECTIONS, type Collection, type Effective, type OverrideOp, type Source, type TemplateContent } from "./types";

/** The common base every template sits on: three sections, no fields. Platform invariants live in code, not here. */
export const BASE: TemplateContent = {
  schema: 1,
  sections: Object.values(SEC),
  fields: [], questions: [], documents: [],
  pricing: { model: "none", groups: [], lines: [] },
  evaluation: { modes: ["qualification", "price", "weighted", "manual"], mode: "weighted", scale: { min: 0, max: 5 }, criteria: [] },
  workflow: [],
};

type Obj = { key: string } & Record<string, unknown>;
const listOf = (c: TemplateContent, col: Collection): Obj[] => {
  switch (col) {
    case "sections": return c.sections as unknown as Obj[];
    case "fields": return c.fields as unknown as Obj[];
    case "questions": return c.questions as unknown as Obj[];
    case "documents": return c.documents as unknown as Obj[];
    case "criteria": return c.evaluation.criteria as unknown as Obj[];
    case "lines": return c.pricing.lines as unknown as Obj[];
  }
};
const setList = (c: TemplateContent, col: Collection, v: Obj[]) => {
  switch (col) {
    case "sections": c.sections = v as never; break;
    case "fields": c.fields = v as never; break;
    case "questions": c.questions = v as never; break;
    case "documents": c.documents = v as never; break;
    case "criteria": c.evaluation = { ...c.evaluation, criteria: v as never }; break;
    case "lines": c.pricing = { ...c.pricing, lines: v as never }; break;
  }
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Stable JSON: object keys sorted, arrays keep their order (order is part of the form). */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ":" + stable((v as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(v);
}
export const hashOf = (v: unknown) => createHash("sha256").update(stable(v)).digest("hex");

export interface ResolveResult { effective: Effective; hash: string; problems: { code: string; message: string; key: string }[] }

/**
 * Layers, lowest first: base, template, company overrides (in the order given), event values.
 * Objects merge by stable key. A template object replaces a base object with the same key. Overrides add, update (shallow merge of
 * the named properties) or remove one object. Nothing is concatenated blindly and no whole form is replaced.
 */
export function resolve(template: TemplateContent, overrides: OverrideOp[] = [], event: OverrideOp[] = []): ResolveResult {
  const out = clone(BASE);
  const prov: Record<string, Source> = {};
  for (const col of COLLECTIONS) for (const o of listOf(out, col)) prov[`${col}:${o.key}`] = "base";
  const problems: ResolveResult["problems"] = [];

  // template layer: replace/add by key; scalar parts come from the template
  for (const col of COLLECTIONS) {
    const cur = listOf(out, col);
    for (const o of clone(listOf(template, col))) {
      const i = cur.findIndex((x) => x.key === o.key);
      if (i >= 0) cur[i] = o; else cur.push(o);
      prov[`${col}:${o.key}`] = "template";
    }
    setList(out, col, cur);
  }
  out.pricing = { ...out.pricing, model: template.pricing.model, groups: clone(template.pricing.groups) };
  out.evaluation = { ...out.evaluation, modes: [...template.evaluation.modes], mode: template.evaluation.mode, scale: { ...template.evaluation.scale } };
  out.workflow = clone(template.workflow);

  const apply = (ops: OverrideOp[], source: Source) => {
    for (const op of ops) {
      const cur = listOf(out, op.collection);
      const i = cur.findIndex((x) => x.key === op.objectKey);
      const id = `${op.collection}:${op.objectKey}`;
      if (op.op === "add") {
        if (i >= 0) { problems.push({ code: "DUPLICATE_KEY", message: `"${op.objectKey}" already exists in ${op.collection}.`, key: id }); continue; }
        cur.push({ ...(clone(op.value ?? {}) as Record<string, unknown>), key: op.objectKey }); prov[id] = source;
      } else if (op.op === "update") {
        if (i < 0) { problems.push({ code: "MISSING_TARGET", message: `Cannot change "${op.objectKey}": it is not in ${op.collection}.`, key: id }); continue; }
        const { key: _ignored, ...rest } = (op.value ?? {}) as Record<string, unknown>;
        cur[i] = { ...cur[i]!, ...clone(rest), key: op.objectKey }; prov[id] = source;
      } else {
        if (i < 0) { problems.push({ code: "MISSING_TARGET", message: `Cannot remove "${op.objectKey}": it is not in ${op.collection}.`, key: id }); continue; }
        cur.splice(i, 1); delete prov[id];
      }
      setList(out, op.collection, cur);
    }
  };
  apply(overrides, "company");
  apply(event, "event");
  const effective: Effective = { ...out, provenance: prov };
  return { effective, hash: hashOf(effective), problems };
}
