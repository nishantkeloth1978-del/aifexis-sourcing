import Link from "next/link";
import { redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { evaluationBoard } from "@/reports/service";

const NEXT: Record<string, string> = {
  closed: "Open the technical envelopes", technical_evaluation: "Score and approve the technical result", technical_approved: "Open the commercial envelopes",
  commercial_evaluation: "Compare prices and recommend", recommended: "Submit for award", pending_award: "Waiting for award approval",
};
const LABEL: Record<string, string> = { closed: "Closed", technical_evaluation: "Technical evaluation", technical_approved: "Technical approved", commercial_evaluation: "Commercial evaluation", recommended: "Recommended", pending_award: "Pending award" };

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const rows = await evaluationBoard(getPool(), s);
  return (
    <Shell title="Evaluations">
      {rows.length === 0 ? <div className="card"><h3>Nothing in evaluation</h3><div className="sub">Events appear here once bidding has closed, until they are awarded.</div></div> : (
        <div className="card detail"><div className="tablewrap"><table className="items"><thead><tr><th>Event</th><th>Stage</th><th className="num">Bidders</th><th>Next step</th><th /></tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.id}><td>{r.ref}<div className="sub">{r.title}</div></td><td><span className="pill warn">{LABEL[r.state] ?? r.state}</span></td><td className="num">{r.bidders}</td><td>{NEXT[r.state] ?? ""}</td><td><Link className="btn ghost" href={`/events/${r.id}`}>Open</Link></td></tr>
          ))}
        </tbody></table></div></div>)}
    </Shell>
  );
}
