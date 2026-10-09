import type { DataClass, EventRole, EventState, MembershipRole } from "./types";

/**
 * The access matrix as data. Every rule says: this holder may read this class,
 * from this state on, optionally only after an envelope was opened, optionally never when a conflict is declared.
 * Keeping the matrix as data lets the mutation tests break a single rule and prove the suite notices.
 */
export interface Rule {
  cls: DataClass;
  scope: "all" | "qualified" | "ownEvaluator";
  from?: EventState;
  needs?: "env1" | "env2";
  notIfConflict?: boolean;
}

export type RuleSet = {
  eventRoles: Record<EventRole, Rule[]>;
  membershipRoles: Record<MembershipRole, Rule[]>;
};

const all = (cls: DataClass, from?: EventState, extra: Partial<Rule> = {}): Rule => ({ cls, scope: "all", ...(from ? { from } : {}), ...extra });
const qualified = (cls: DataClass, from: EventState, needs: "env1" | "env2"): Rule => ({ cls, scope: "qualified", from, needs });

export const DEFAULT_RULES: RuleSet = {
  eventRoles: {
    requester: [all("D1"), all("D2", "published")],
    buyer: [
      all("D1"), all("D2"), all("D3"), all("D4"), all("D5"),
      all("D6", "technical_evaluation", { needs: "env1" }),
      all("D8", "technical_evaluation", { needs: "env1" }),
      qualified("D7", "commercial_evaluation", "env2"),
      qualified("D9", "commercial_evaluation", "env2"),
      all("D10", "technical_evaluation"), all("D11", "technical_evaluation"), all("D12", "technical_approved"),
      all("D13", "commercial_evaluation"), all("D14", "commercial_evaluation"),
      all("D15"), all("D16", "awarded"), all("D17", "awarded"), all("D18"),
    ],
    tech_evaluator: [
      all("D1"), all("D2", "published"), all("D5"),
      all("D6", "technical_evaluation", { needs: "env1", notIfConflict: true }),
      all("D8", "technical_evaluation", { needs: "env1", notIfConflict: true }),
      all("D10", "technical_evaluation"),
      { cls: "D11", scope: "ownEvaluator", from: "technical_evaluation" },
      all("D11", "technical_approved"), // everyone's scores become visible once the technical result is approved
      all("D12", "technical_approved"), all("D16", "awarded"),
    ],
    comm_evaluator: [
      all("D1"), all("D2", "published"), all("D5"),
      qualified("D7", "commercial_evaluation", "env2"),
      qualified("D9", "commercial_evaluation", "env2"),
      all("D12", "technical_approved"), all("D13", "commercial_evaluation"),
      all("D14", "recommended"), all("D16", "awarded"),
    ],
    publication_approver: [all("D1"), all("D2"), all("D3", "pending_publication"), all("D4", "pending_publication")],
    tech_approver: [all("D1"), all("D2"), all("D10", "technical_evaluation"), all("D11", "technical_evaluation"), all("D12", "technical_evaluation")],
    award_approver: [
      all("D1"), all("D2"), all("D12", "technical_approved"), all("D13", "pending_award"),
      all("D14", "pending_award"), all("D15"), all("D16", "awarded"),
    ],
    witness: [all("D2", "published")],
    auditor: [
      all("D1"), all("D2"), all("D5"),
      all("D6", "technical_evaluation", { needs: "env1" }), all("D8", "technical_evaluation", { needs: "env1" }),
      qualified("D7", "commercial_evaluation", "env2"), qualified("D9", "commercial_evaluation", "env2"),
      all("D10", "technical_evaluation"), all("D11", "technical_evaluation"), all("D12", "technical_approved"),
      all("D13", "commercial_evaluation"), all("D14", "commercial_evaluation"),
      all("D15"), all("D16", "awarded"), all("D17", "awarded"), all("D18"),
    ],
  },
  membershipRoles: {
    admin: [all("D19"), all("D18")],
    integration_admin: [all("D17")],
    member: [],
  },
};

/** Supplier rules apply to a supplier user with an invitation to the event. */
export const SUPPLIER_CLASSES = {
  D2: { from: "published" as EventState },
  D5: { from: "published" as EventState }, // shared threads plus the supplier's own private ones
  D6: {}, // own bid, in any state
  D7: {}, // own bid, in any state
  D16: { from: "awarded" as EventState },
};

/** Classes a break-glass grant opens, for the granted event only, until it expires. */
export const BREAK_GLASS_CLASSES: DataClass[] = ["D6", "D7", "D8", "D9"];

export interface TransitionDef {
  from: EventState[];
  to: EventState;
  roles: EventRole[]; // event roles allowed to run it (directly or by delegation)
  /** The acting member must hold none of these event roles on the event (separation of duties). */
  forbiddenOwnRoles?: EventRole[];
  needsWitness?: boolean;
  allowSystem?: boolean;
  /** Needs an approving award approver (procurement manager) named in the payload. */
  needsPmApproval?: boolean;
}

const SOD: EventRole[] = ["buyer", "tech_evaluator", "comm_evaluator"];

export const TRANSITIONS: Record<string, TransitionDef> = {
  SubmitForPublication: { from: ["draft"], to: "pending_publication", roles: ["buyer"] },
  ApprovePublication: { from: ["pending_publication"], to: "published", roles: ["publication_approver"], forbiddenOwnRoles: SOD, allowSystem: true },
  CloseEvent: { from: ["published"], to: "closed", roles: ["buyer"], allowSystem: true },
  OpenEnvelope1: { from: ["closed"], to: "technical_evaluation", roles: ["buyer"], needsWitness: true },
  ApproveTechnicalResult: { from: ["technical_evaluation"], to: "technical_approved", roles: ["tech_approver"], forbiddenOwnRoles: SOD },
  OpenEnvelope2: { from: ["technical_approved"], to: "commercial_evaluation", roles: ["buyer"], needsWitness: true },
  RecordRecommendation: { from: ["commercial_evaluation", "recommended"], to: "recommended", roles: ["buyer"] },   // also from recommended: the buyer may revise after an approver sent the award back
  SubmitForAward: { from: ["recommended"], to: "pending_award", roles: ["buyer"] },
  ApproveAward: { from: ["pending_award"], to: "awarded", roles: ["award_approver"], forbiddenOwnRoles: SOD },
  RejectAward: { from: ["pending_award"], to: "recommended", roles: ["award_approver"], forbiddenOwnRoles: SOD },
  /** Best-and-final: only the shortlisted bidders are invited to revise their bids; needs an award approver's agreement. */
  StartFinalRound: { from: ["commercial_evaluation", "recommended"], to: "published", roles: ["buyer"], needsPmApproval: true },
  /** Stops the event for good. Needs an award approver's agreement, like a final round. */
  CancelEvent: {
    from: ["pending_publication", "published", "closed", "technical_evaluation", "technical_approved", "commercial_evaluation", "recommended", "pending_award"],
    to: "cancelled", roles: ["buyer"], needsPmApproval: true,
  },
  ReopenForAmendment: {
    from: ["closed", "technical_evaluation", "technical_approved", "commercial_evaluation"],
    to: "published", roles: ["buyer"], needsPmApproval: true,
  },
};
