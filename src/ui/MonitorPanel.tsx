import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { Monitor } from "@/automation/monitor-types";

/** How the sourcing work is flowing and what the automation did, for the last 30 days. */
export default function MonitorPanel({ locale, m }: { locale: Locale; m: Monitor }) {
  const name = (a: string) => (a === "drafter" ? tx(locale, "Event drafter") : a === "reader" ? tx(locale, "Bid reader") : tx(locale, "Recommender"));
  const stat = (label: string, v: string | number) => <div className="stat"><div className="sub">{label}</div><b>{v}</b></div>;
  return (
    <section className="card detail" style={{ maxWidth: 760 }} aria-label={tx(locale, "Automation monitor")}>
      <div className="row"><h3>{tx(locale, "Automation monitor")}</h3></div>
      <div className="sub">{tx(locale, "The last {n} days.", { n: m.days })}</div>
      <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
        {stat(tx(locale, "Events awarded"), m.awarded)}
        {stat(tx(locale, "Median days, first activity to award"), m.medianCycleDays ?? "-")}
        {stat(tx(locale, "Average workflow steps per awarded event"), m.avgSteps ?? "-")}
        {stat(tx(locale, "Automatic actions"), m.auto)}
      </div>
      <h4>{tx(locale, "AI proposals")}</h4>
      {m.agents.length === 0 ? <div className="sub">{tx(locale, "No AI proposals yet.")}</div> : (
        <table className="table"><thead><tr><th>{tx(locale, "Agent")}</th><th>{tx(locale, "Runs")}</th><th>{tx(locale, "Failed")}</th><th>{tx(locale, "Accepted")}</th><th>{tx(locale, "Discarded")}</th></tr></thead>
          <tbody>{m.agents.map((a) => <tr key={a.agent}><td>{name(a.agent)}</td><td>{a.runs}</td><td>{a.failed}</td><td>{a.accepted}</td><td>{a.rejected}</td></tr>)}</tbody></table>)}
      <h4>{tx(locale, "Needs attention")}</h4>
      <ul>
        <li>{tx(locale, "Requests waiting for a decision")}: {m.newRequests}</li>
        <li>{tx(locale, "Open bid checks")}: {m.openChecks}</li>
        <li>{tx(locale, "Webhooks that failed for good")}: {m.deadWebhooks} ({tx(locale, "waiting to retry")}: {m.pendingWebhooks})</li>
      </ul>
    </section>
  );
}
