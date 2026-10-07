/** Data classes (spec: Event Lifecycle and Authorization v0.1, section 4). D20 (own bid) is expressed as D6/D7 with an own-supplier scope. */
export type DataClass =
  | "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "D8" | "D9" | "D10"
  | "D11" | "D12" | "D13" | "D14" | "D15" | "D16" | "D17" | "D18" | "D19";

export const BID_CLASSES: DataClass[] = ["D6", "D7", "D8", "D9"];

export type EventState =
  | "draft" | "pending_publication" | "published" | "closed" | "technical_evaluation"
  | "technical_approved" | "commercial_evaluation" | "recommended" | "pending_award"
  | "awarded" | "handover_pending" | "handed_over" | "archived" | "cancelled" | "retendered";

/** Order of the normal lifecycle; used for "at or after" rules. Cancelled and retendered events sit outside it. */
export const STATE_ORDER: EventState[] = [
  "draft", "pending_publication", "published", "closed", "technical_evaluation", "technical_approved",
  "commercial_evaluation", "recommended", "pending_award", "awarded", "handover_pending", "handed_over", "archived",
];

export function reached(state: EventState, from: EventState): boolean {
  const s = STATE_ORDER.indexOf(state);
  return s >= 0 && s >= STATE_ORDER.indexOf(from);
}

export type EventRole =
  | "requester" | "buyer" | "tech_evaluator" | "comm_evaluator" | "witness"
  | "publication_approver" | "tech_approver" | "award_approver" | "auditor";

export type MembershipRole = "admin" | "integration_admin" | "member";

/** What a holder may see of a class: every row, only qualified bidders' rows, only their own, and so on. */
export type Scope =
  | { kind: "all" }
  | { kind: "qualified" }
  | { kind: "ownSupplier"; supplierId: string }
  | { kind: "ownEvaluator"; membershipId: string }
  | { kind: "sharedPlusOwn"; supplierId: string };

export type Permitted = Partial<Record<DataClass, Scope>>;

export type Actor =
  | { kind: "internal"; userId: string; tenantId: string }
  | { kind: "supplier"; supplierUserId: string; tenantId: string }
  | { kind: "job"; jobId: string; tenantId: string; onBehalfOfUserId: string; grants: DataClass[] }
  | { kind: "operator"; operatorId: string; tenantId: string; breakGlassGrantId?: string }
  | { kind: "system"; tenantId: string };

export interface Decision {
  allow: boolean;
  /** Stable reason code, e.g. NOT_FOUND, ENVELOPE_SEALED, FORBIDDEN, BAD_STATE, STALE_VERSION, SOD_VIOLATION. */
  reason: string;
  scope?: Scope;
}

export interface EventRow {
  id: string;
  tenantId: string;
  title: string;
  state: EventState;
  stateVersion: number;
  currentVersion: number;
  closesAt: Date | null;
  envelope1OpenedAt: Date | null;
  envelope2OpenedAt: Date | null;
  requiredAwardApprovals: number;
  configSnapshot: unknown;
}

export const allow = (reason = "OK", scope?: Scope): Decision => ({ allow: true, reason, ...(scope ? { scope } : {}) });
export const deny = (reason: string): Decision => ({ allow: false, reason });
