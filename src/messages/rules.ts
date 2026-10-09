/** Pure rules for event messaging: which phase an event is in, what each side may do, redaction and the equal-treatment check. */

export type Phase = "none" | "open" | "closed" | "awarded" | "cancelled" | "readonly";

export function phaseOf(state: string, closesAt: Date | null, now = new Date()): Phase {
  if (state === "draft" || state === "pending_publication") return "none";
  if (state === "published") return closesAt && closesAt.getTime() <= now.getTime() ? "closed" : "open";
  if (["closed", "technical_evaluation", "technical_approved", "commercial_evaluation", "recommended", "pending_award"].includes(state)) return "closed";
  if (state === "awarded") return "awarded";
  if (state === "cancelled") return "cancelled";
  return "readonly";
}

export interface Rules {
  askBoard: boolean;            // a supplier may ask a new public question
  answerBoard: boolean;         // staff may answer and publish
  supplierStartsPrivate: boolean;
  staffStartsPrivate: boolean;
  supplierReplies: boolean;     // a supplier may reply in an existing private thread (after closing: only to an open request)
  notices: boolean;
  late: boolean;                // answers are past the published last answer date
}

export function rulesFor(phase: Phase, dl: { questionDeadline: Date | null; lastAnswerDate: Date | null }, now = new Date()): Rules {
  const none: Rules = { askBoard: false, answerBoard: false, supplierStartsPrivate: false, staffStartsPrivate: false, supplierReplies: false, notices: false, late: false };
  switch (phase) {
    case "open": return { askBoard: !dl.questionDeadline || now <= dl.questionDeadline, answerBoard: true, supplierStartsPrivate: true, staffStartsPrivate: true, supplierReplies: true, notices: true, late: !!dl.lastAnswerDate && now > dl.lastAnswerDate };
    case "closed": return { ...none, staffStartsPrivate: true, supplierReplies: true, notices: true };
    case "awarded": return { ...none, staffStartsPrivate: true, supplierReplies: true, notices: true };
    default: return none;
  }
}

/** After closing a supplier may reply only while a buyer request is open. Before closing there is no such limit. */
export function supplierMayReply(phase: Phase, requestDueAt: Date | null, now = new Date()): boolean {
  if (phase === "open" || phase === "awarded") return true;
  if (phase === "closed") return !!requestDueAt && now <= requestDueAt;
  return false;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+|00)?\d[\d\s().-]{7,}\d/g;
const URL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Removes names, e-mail addresses, phone numbers and links, so an answer can be shared without saying who asked. */
export function redact(text: string, names: string[] = []): { text: string; changed: boolean } {
  let out = text;
  for (const n of [...names].filter((x) => x && x.trim().length >= 3).sort((a, b) => b.length - a.length)) out = out.replace(new RegExp(esc(n.trim()), "gi"), "[bidder]");
  out = out.replace(EMAIL, "[email removed]").replace(URL, "[link removed]").replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 8 ? "[number removed]" : m));
  return { text: out, changed: out !== text };
}

/** Flags text that looks like it changes or clarifies the requirement, which every bidder should hear. Advice only. */
export function looksLikeClarification(text: string): boolean {
  const t = text.toLowerCase();
  const words = /\b(quantit|specification|spec\b|scope|deadline|extension|extended|delivery date|required date|will now|no longer|must now|amend|changed to|change to|revised|replace[ds]?|alternative|equivalent|accepted?\b|not accepted|allowed|not allowed|permitted|mandatory|requirement|standard|drawing|addendum|clarif)/;
  const figure = /\b\d[\d,.]*\s?(pcs|pieces|units|ea|kg|m2|m3|mm|cm|days|weeks|months|aed|usd|%)\b/;
  return words.test(t) || figure.test(t);
}

export const MAX_FILES = 3;
