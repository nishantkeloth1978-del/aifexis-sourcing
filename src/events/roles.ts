// Client-safe constants (no database imports).
export const EVENT_ROLES = [
  "requester", "buyer", "publication_approver", "tech_evaluator", "comm_evaluator", "witness", "tech_approver", "award_approver", "auditor",
] as const;
export type EventRoleName = (typeof EVENT_ROLES)[number];
export const ROLE_LABEL: Record<EventRoleName, string> = {
  requester: "Requester", buyer: "Buyer", publication_approver: "Publication approver", tech_evaluator: "Technical evaluator",
  comm_evaluator: "Commercial evaluator", witness: "Witness", tech_approver: "Technical approver", award_approver: "Award approver", auditor: "Auditor",
};
