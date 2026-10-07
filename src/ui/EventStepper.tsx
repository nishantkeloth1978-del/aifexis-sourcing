const STEPS = ["Draft", "Approval", "Open for bids", "Evaluation", "Award", "Done"] as const;
const INDEX: Record<string, number> = {
  draft: 0, pending_publication: 1, published: 2, closed: 3, technical_evaluation: 3, technical_approved: 3, commercial_evaluation: 3,
  recommended: 4, pending_award: 4, awarded: 5, handover_pending: 5, handed_over: 5, archived: 5,
};
const SUB: Record<string, string> = {
  draft: "Add lines and a closing date, then submit for approval", pending_publication: "Waiting for the publication approver", published: "Suppliers can bid until the closing time",
  closed: "Bidding is closed. Open the technical envelopes", technical_evaluation: "Technical scoring in progress", technical_approved: "Open the commercial envelopes",
  commercial_evaluation: "Review the ranking and recommend a bidder", recommended: "Submit the recommendation for award approval", pending_award: "Waiting for award approval", awarded: "Awarded",
};

export default function EventStepper({ state }: { state: string }) {
  if (state === "cancelled" || state === "retendered") return <div className="stepper"><div className="stephint">This event was {state}.</div></div>;
  const at = INDEX[state] ?? 0;
  return (
    <div className="stepper" aria-label="Progress">
      <ol>{STEPS.map((s, i) => <li key={s} className={i < at ? "done" : i === at ? "now" : ""} aria-current={i === at ? "step" : undefined}><i>{i < at ? "✓" : i + 1}</i><span>{s}</span></li>)}</ol>
      <div className="stephint">{SUB[state] ?? ""}</div>
    </div>
  );
}
