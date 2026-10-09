import type { EventRoleName } from "./roles";

export interface ReadinessInput {
  state: string; title: string; closesAt: string | null; itemCount: number; itemsWithLots: boolean; lotsNeeded: boolean;
  teamRoles: string[]; myRoles: EventRoleName[]; isAdmin: boolean; docCount: number; bidCount?: number;
}
export interface Task { key: string; label: string; done: boolean; required: boolean }
export interface Workspace { tasks: Task[]; next: string; ready: boolean }

/** The to-do list and the one next action shown at the top of the event workspace. Labels are English source text for tx(). */
export function workspaceOf(i: ReadinessInput): Workspace {
  if (i.state === "draft") {
    const tasks: Task[] = [
      { key: "title", label: "Give the event a title", done: i.title.trim().length >= 3, required: true },
      { key: "close", label: "Set a closing date", done: Boolean(i.closesAt), required: true },
      { key: "items", label: "Add at least one item to price", done: i.itemCount > 0, required: true },
      ...(i.lotsNeeded ? [{ key: "lots", label: "Put every item in a lot", done: i.itemsWithLots, required: true }] : []),
      { key: "buyer", label: "Assign a buyer", done: i.teamRoles.includes("buyer"), required: true },
      { key: "approver", label: "Assign a publication approver", done: i.teamRoles.includes("publication_approver"), required: true },
      { key: "docs", label: "Upload tender documents", done: i.docCount > 0, required: false },
    ];
    const open = tasks.find((t) => t.required && !t.done);
    const ready = !open;
    return { tasks, ready, next: open ? open.label : i.myRoles.includes("buyer") ? "Submit the event for publication approval" : "Waiting for the buyer to submit the event" };
  }
  const NEXT: Record<string, [string, string]> = {
    pending_publication: ["publication_approver", "Review and approve the event for publication"],
    published: ["buyer", "Invite suppliers and answer clarification questions"],
    closed: ["buyer", "Open the technical envelopes with a witness"],
    technical_evaluation: ["tech_evaluator", "Score the technical responses"],
    technical_approved: ["buyer", "Open the commercial envelopes with a witness"],
    commercial_evaluation: ["buyer", "Review the comparison and record a recommendation"],
    recommended: ["buyer", "Submit the recommendation for award approval"],
    pending_award: ["award_approver", "Approve or send back the award"],
  };
  const n = NEXT[i.state];
  if (!n) return { tasks: [], ready: true, next: i.state === "awarded" ? "The event is awarded" : "No action is needed" };
  return { tasks: [], ready: true, next: i.myRoles.includes(n[0] as EventRoleName) ? n[1] : `Waiting for: ${n[1].charAt(0).toLowerCase()}${n[1].slice(1)}` };
}
