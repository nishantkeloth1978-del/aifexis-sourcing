/** The status groups people filter by, and the database states each one covers. */
export const GROUP_STATES: Record<string, string[]> = {
  Draft: ["draft", "pending_publication"],
  Open: ["published"],
  Evaluating: ["closed", "technical_evaluation", "technical_approved", "commercial_evaluation", "recommended", "pending_award"],
  Awarded: ["awarded", "handover_pending", "handed_over"],
  Archived: ["archived"],
  Cancelled: ["cancelled", "retendered"],
};
export const STATE_GROUP: Record<string, string> = Object.fromEntries(Object.entries(GROUP_STATES).flatMap(([g, ss]) => ss.map((s) => [s, g])));
export const PAGE_SIZE = 24;
