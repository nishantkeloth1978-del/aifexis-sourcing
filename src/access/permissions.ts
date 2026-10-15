/**
 * What a person may do in the organisation (not on one event). A permission is a plain key. The administrator role has all of them,
 * fixed in code. Other roles get the set their organisation chose, or the defaults below.
 * Sealed envelopes, scoring, approvals and bid data are governed by EVENT roles and data classes, never by these permissions.
 */
export interface PermDef { key: string; label: string; group: "Events" | "Master data" | "Setup" | "People" | "Reporting"; help: string; adminOnly?: boolean }

export const PERMISSIONS: readonly PermDef[] = [
  { key: "request.create", label: "Raise purchase and service requests", group: "Events", help: "Raise a request for goods or services and follow it. Buyers (who can create events) also see and handle everyone's requests." },
  { key: "event.create", label: "Create and edit own events", group: "Events", help: "Start events and edit the drafts they created or are assigned to as buyer or requester." },
  { key: "event.read_all", label: "See every event", group: "Events", help: "See all events of the organisation, not only those they created or are on the team of." },
  { key: "event.edit_any_draft", label: "Edit anyone's draft", group: "Events", help: "Change the items and basics of drafts created by others." },
  { key: "event.delete_any", label: "Delete anyone's draft", group: "Events", help: "Delete draft events created by others." },
  { key: "event.assign_roles", label: "Assign event roles and approvers", group: "Events", help: "Put people on an event team and set approver routes." },
  { key: "event.invite_any", label: "Invite suppliers to any event", group: "Events", help: "Invite suppliers to events they are not the buyer of." },
  { key: "event.handover", label: "Hand over awards to other systems", group: "Events", help: "Send an awarded event to the purchasing system." },
  { key: "evaluation.override", label: "Act for the event buyer", group: "Events", help: "Reassign evaluators and approve score changes on any event." },
  { key: "catalog.manage", label: "Manage the item catalogue", group: "Master data", help: "Add, change and retire catalogue items." },
  { key: "supplier.manage", label: "Manage suppliers", group: "Master data", help: "Add and change suppliers and their contacts." },
  { key: "template.manage", label: "Manage templates and company setup", group: "Setup", help: "Company profile, policies, template library and custom templates." },
  { key: "template.approve", label: "Approve template changes", group: "Setup", help: "Approve or reject changed templates when approval is required." },
  { key: "config.manage", label: "Change evaluation configuration", group: "Setup", help: "Weights, thresholds and gates used for new events." },
  { key: "reports.view_all", label: "See reports for every event", group: "Reporting", help: "Evaluation board and award reports across all events." },
  { key: "users.manage", label: "Manage users", group: "People", help: "Invite, change and switch off people.", adminOnly: true },
  { key: "roles.manage", label: "Manage roles and permissions", group: "People", help: "Edit what each role may do.", adminOnly: true },
] as const;

export type Perm = (typeof PERMISSIONS)[number]["key"];
export const ALL_PERMS: readonly string[] = PERMISSIONS.map((p) => p.key);
export const ADMIN_ONLY: ReadonlySet<string> = new Set(PERMISSIONS.filter((p) => p.adminOnly).map((p) => p.key));
export const isPerm = (k: string) => ALL_PERMS.includes(k);

/** Defaults when an organisation has not changed a built-in role. Same behaviour as before roles became configurable, except that members see only their own events. */
export const DEFAULT_PERMS: Record<string, readonly string[]> = {
  admin: ALL_PERMS,
  member: ["request.create", "event.create", "catalog.manage", "supplier.manage"],
  integration_admin: [],
};

/** Anything with a role key and, when loaded from the database, its resolved permission list. */
export interface HasPerms { role: string; perms?: readonly string[] }

/** The one question every screen and service asks. A person without resolved permissions falls back to their role's defaults. */
export function can(who: HasPerms, perm: Perm | string): boolean {
  if (who.role === "admin") return true;
  return (who.perms ?? DEFAULT_PERMS[who.role] ?? []).includes(perm);
}

/** Removes anything a non-administrator role may not hold. Used when saving a role, so the guardrail cannot be bypassed from the screen. */
export function allowedForRole(requested: readonly string[]): string[] {
  return [...new Set(requested)].filter((p) => isPerm(p) && !ADMIN_ONLY.has(p));
}
