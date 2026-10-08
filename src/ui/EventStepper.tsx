import { t, type Key, type Locale } from "@/i18n/dict";

const STEPS: Key[] = ["step1", "step2", "step3", "step4", "step5", "step6"];
const INDEX: Record<string, number> = {
  draft: 0, pending_publication: 1, published: 2, closed: 3, technical_evaluation: 3, technical_approved: 3, commercial_evaluation: 3,
  recommended: 4, pending_award: 4, awarded: 5, handover_pending: 5, handed_over: 5, archived: 5,
};
const SUB: Record<string, Key> = {
  draft: "h_draft", pending_publication: "h_pending", published: "h_published", closed: "h_closed", technical_evaluation: "h_tech", technical_approved: "h_techok",
  commercial_evaluation: "h_comm", recommended: "h_rec", pending_award: "h_pendaward", awarded: "h_awarded",
};

export default function EventStepper({ state, locale = "en" }: { state: string; locale?: Locale }) {
  if (state === "cancelled" || state === "retendered") return <div className="stepper"><div className="stephint">{t(locale, "wasCancelled", { s: t(locale, state === "cancelled" ? "sCancelled" : "sRetendered").toLowerCase() })}</div></div>;
  const at = INDEX[state] ?? 0;
  return (
    <div className="stepper" aria-label={t(locale, "progress")}>
      <ol>{STEPS.map((s, i) => <li key={s} className={i < at ? "done" : i === at ? "now" : ""} aria-current={i === at ? "step" : undefined}><i>{i < at ? "✓" : i + 1}</i><span>{t(locale, s)}</span></li>)}</ol>
      <div className="stephint">{SUB[state] ? t(locale, SUB[state]!) : ""}</div>
    </div>
  );
}
