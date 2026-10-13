import type { EventRoleName } from "./roles";

export interface ReadinessInput {
  state: string; title: string; closesAt: string | null; itemCount: number; itemsWithLots: boolean; lotsNeeded: boolean;
  teamRoles: string[]; myRoles: EventRoleName[]; isAdmin: boolean; docCount: number; bidCount?: number;
}
export type WsTab = "overview" | "items" | "docs" | "eval" | "team";
export interface Task { key: string; label: string; done: boolean; required: boolean; tab?: WsTab }
/** `tab` is where the next step is done; `waitingRole` is whose step it is when it is not mine. */
export interface Workspace { tasks: Task[]; next: string; ready: boolean; tab?: WsTab; waitingRole?: string }

/** The to-do list and the one next action shown at the top of the event workspace. Labels are English source text for tx(). */
export function workspaceOf(i: ReadinessInput): Workspace {
  if (i.state === "draft") {
    const tasks: Task[] = [
      { key: "title", label: "Give the event a title", done: i.title.trim().length >= 3, required: true, tab: "overview" },
      { key: "close", label: "Set a closing date", done: Boolean(i.closesAt), required: true, tab: "overview" },
      { key: "items", label: "Add at least one item to price", done: i.itemCount > 0, required: true, tab: "items" },
      ...(i.lotsNeeded ? [{ key: "lots", label: "Put every item in a lot", done: i.itemsWithLots, required: true, tab: "items" as WsTab }] : []),
      { key: "buyer", label: "Assign a buyer", done: i.teamRoles.includes("buyer"), required: true, tab: "team" },
      { key: "approver", label: "Assign a publication approver", done: i.teamRoles.includes("publication_approver"), required: true, tab: "team" },
      { key: "docs", label: "Upload tender documents", done: i.docCount > 0, required: false, tab: "docs" },
    ];
    const open = tasks.find((t) => t.required && !t.done);
    const ready = !open;
    return { tasks, ready, tab: open?.tab, waitingRole: !open && !i.myRoles.includes("buyer") ? "buyer" : undefined, next: open ? open.label : i.myRoles.includes("buyer") ? "Submit the event for publication approval" : "Waiting for the buyer to submit the event" };
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
  const mine = i.myRoles.includes(n[0] as EventRoleName);
  const tab: WsTab = i.state === "pending_publication" ? "overview" : "eval";
  return { tasks: [], ready: true, tab: mine ? tab : undefined, waitingRole: mine ? undefined : n[0], next: mine ? n[1] : `Waiting for: ${n[1].charAt(0).toLowerCase()}${n[1].slice(1)}` };
}
