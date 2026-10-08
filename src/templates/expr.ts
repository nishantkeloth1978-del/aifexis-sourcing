/**
 * A deliberately small expression language for conditions and quantities. No functions, no property access beyond dotted keys,
 * no code execution: tokens are parsed into a tree and evaluated over a plain value map.
 *   conditions:  qty > 0 and not no_bid        brand == "Acme"        type in ["a","b"]
 *   quantities:  headcount * days              staff * (normal_hours + 0.5 * overtime_hours)
 * Numbers are exact decimals (scaled integers, 6 places). Division rounds half up.
 */
import { roundDiv } from "@/engine/decimal";

export class ExprError extends Error {}
const SCALE = 6, ONE = 10n ** BigInt(SCALE);

type Tok = { t: "num" | "str" | "id" | "op" | "kw" | "eof"; v: string };
export type Node =
  | { k: "num"; v: bigint } | { k: "str"; v: string } | { k: "bool"; v: boolean } | { k: "ref"; id: string }
  | { k: "un"; op: "not" | "-"; a: Node } | { k: "bin"; op: string; a: Node; b: Node } | { k: "list"; items: Node[] };

const KW = new Set(["and", "or", "not", "in", "true", "false"]);
function tokens(src: string): Tok[] {
  if (src.length > 500) throw new ExprError("The expression is too long.");
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (/\d/.test(ch) || (ch === "." && /\d/.test(src[i + 1] ?? ""))) { let j = i; while (/[\d.]/.test(src[j] ?? "")) j++; out.push({ t: "num", v: src.slice(i, j) }); i = j; continue; }
    if (ch === '"') { const j = src.indexOf('"', i + 1); if (j < 0) throw new ExprError("Unterminated text in the expression."); out.push({ t: "str", v: src.slice(i + 1, j) }); i = j + 1; continue; }
    if (/[a-z_]/i.test(ch)) { let j = i; while (/[\w.]/.test(src[j] ?? "")) j++; const w = src.slice(i, j); out.push({ t: KW.has(w) ? "kw" : "id", v: w }); i = j; continue; }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">="].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/<>()[],".includes(ch)) { out.push({ t: "op", v: ch }); i++; continue; }
    throw new ExprError(`Unexpected character "${ch}" in the expression.`);
  }
  out.push({ t: "eof", v: "" });
  return out;
}

export function parse(src: string): Node {
  const ts = tokens(src); let p = 0;
  const peek = () => ts[p]!, next = () => ts[p++]!;
  const isOp = (v: string) => peek().t === "op" && peek().v === v;
  const isKw = (v: string) => peek().t === "kw" && peek().v === v;
  function orE(): Node { let a = andE(); while (isKw("or")) { next(); a = { k: "bin", op: "or", a, b: andE() }; } return a; }
  function andE(): Node { let a = notE(); while (isKw("and")) { next(); a = { k: "bin", op: "and", a, b: notE() }; } return a; }
  function notE(): Node { if (isKw("not")) { next(); return { k: "un", op: "not", a: notE() }; } return cmp(); }
  function cmp(): Node {
    const a = add();
    for (const op of ["==", "!=", "<=", ">=", "<", ">"]) if (isOp(op)) { next(); return { k: "bin", op, a, b: add() }; }
    if (isKw("in")) { next(); if (!isOp("[")) throw new ExprError('"in" needs a list such as ["a", "b"].'); return { k: "bin", op: "in", a, b: list() }; }
    return a;
  }
  function list(): Node { next(); const items: Node[] = []; while (!isOp("]")) { items.push(add()); if (isOp(",")) next(); else if (!isOp("]")) throw new ExprError("A list needs commas between its values."); } next(); return { k: "list", items }; }
  function add(): Node { let a = mul(); while (isOp("+") || isOp("-")) { const op = next().v; a = { k: "bin", op, a, b: mul() }; } return a; }
  function mul(): Node { let a = unary(); while (isOp("*") || isOp("/")) { const op = next().v; a = { k: "bin", op, a, b: unary() }; } return a; }
  function unary(): Node { if (isOp("-")) { next(); return { k: "un", op: "-", a: unary() }; } return atom(); }
  function atom(): Node {
    const t = next();
    if (t.t === "num") { const [i = "0", f = ""] = t.v.split("."); if (f.length > SCALE) throw new ExprError("Too many decimals in a number."); return { k: "num", v: BigInt(i + f.padEnd(SCALE, "0")) }; }
    if (t.t === "str") return { k: "str", v: t.v };
    if (t.t === "kw" && (t.v === "true" || t.v === "false")) return { k: "bool", v: t.v === "true" };
    if (t.t === "id") return { k: "ref", id: t.v };
    if (t.t === "op" && t.v === "(") { const e = orE(); if (!isOp(")")) throw new ExprError('Missing ")" in the expression.'); next(); return e; }
    throw new ExprError(`Unexpected "${t.v || "end"}" in the expression.`);
  }
  const root = orE();
  if (peek().t !== "eof") throw new ExprError(`Unexpected "${peek().v}" in the expression.`);
  return root;
}

export function refs(n: Node, out: string[] = []): string[] {
  if (n.k === "ref") out.push(n.id);
  else if (n.k === "un") refs(n.a, out);
  else if (n.k === "bin") { refs(n.a, out); refs(n.b, out); }
  else if (n.k === "list") n.items.forEach((i) => refs(i, out));
  return out;
}

export type Val = bigint | string | boolean | null | undefined;
export type Env = Record<string, string | number | boolean | null | undefined>;
const toVal = (v: Env[string]): Val => {
  if (typeof v === "number") return BigInt(Math.round(v * 1e6));
  if (typeof v === "string" && /^-?\d+(\.\d{1,6})?$/.test(v)) { const neg = v.startsWith("-"); const [i = "0", f = ""] = (neg ? v.slice(1) : v).split("."); const b = BigInt(i + f.padEnd(SCALE, "0")); return neg ? -b : b; }
  return v ?? null;
};

/** Evaluates a tree. A missing reference gives null; arithmetic or ordering over null gives null (unknown), so callers can flag "incomplete". */
export function evaluate(n: Node, env: Env): Val {
  switch (n.k) {
    case "num": return n.v;
    case "str": return n.v;
    case "bool": return n.v;
    case "ref": return toVal(env[n.id]);
    case "list": return null;
    case "un": { const a = evaluate(n.a, env); if (n.op === "not") return a == null ? null : !a; return typeof a === "bigint" ? -a : null; }
    case "bin": {
      if (n.op === "and" || n.op === "or") {
        const a = evaluate(n.a, env), b = evaluate(n.b, env);
        if (n.op === "and") { if (a === false || b === false) return false; return a == null || b == null ? null : Boolean(a && b); }
        if (a === true || b === true) return true; return a == null || b == null ? null : Boolean(a || b);
      }
      if (n.op === "in") { const a = evaluate(n.a, env); if (a == null) return null; return (n.b as Extract<Node, { k: "list" }>).items.some((i) => evaluate(i, env) === a); }
      const a = evaluate(n.a, env), b = evaluate(n.b, env);
      if (a == null || b == null) return null;
      if (n.op === "==") return a === b;
      if (n.op === "!=") return a !== b;
      if (typeof a === "bigint" && typeof b === "bigint") {
        switch (n.op) {
          case "+": return a + b; case "-": return a - b; case "*": return roundDiv(a * b, ONE);
          case "/": if (b === 0n) throw new ExprError("Division by zero in the expression."); return roundDiv(a * ONE, b < 0n ? -b : b) * (b < 0n ? -1n : 1n);
          case "<": return a < b; case ">": return a > b; case "<=": return a <= b; case ">=": return a >= b;
        }
      }
      if (typeof a === "string" && typeof b === "string") { if (n.op === "<") return a < b; if (n.op === ">") return a > b; }
      throw new ExprError("The expression mixes numbers and text.");
    }
  }
}

/** Decimal string with up to 3 places from a scaled value, or null. */
export const toDecimal3 = (v: Val): string | null => {
  if (typeof v !== "bigint") return null;
  const r = roundDiv(v, 10n ** BigInt(SCALE - 3)), neg = r < 0n, s = (neg ? -r : r).toString().padStart(4, "0");
  return (neg ? "-" : "") + s.slice(0, -3) + "." + s.slice(-3);
};
