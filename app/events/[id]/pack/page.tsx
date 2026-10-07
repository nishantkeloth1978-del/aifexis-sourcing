import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getAwardPack } from "@/pack/service";
import PrintButton from "@/ui/PrintButton";

export const metadata = { title: "Award pack | Aifexis Sourcing" };
const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "-");

export default async function Pack({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/no-access");
  const p = await getAwardPack(getPool(), s, id);
  if (!p) notFound();
  return (
    <div className="pack">
      <div className="packbar"><a className="sublink" href={`/events/${id}`}>&larr; Back to event</a><PrintButton /></div>
      <h1>Award pack: {p.event.ref}</h1>
      <p>{p.event.title}<br /><span className="sub">{p.event.ownerDept && `${p.event.ownerDept} | `}Currency {p.event.currency || "-"} | Status {p.event.state} | Generated {at(p.generatedAt)}</span></p>

      <h2>1. Timeline</h2>
      <table className="items"><tbody>
        <tr><td>Created</td><td>{at(p.event.createdAt)}</td></tr><tr><td>Bidding closed at</td><td>{at(p.event.closesAt)}</td></tr>
        {p.openings.map((o, i) => <tr key={i}><td>Envelope {o.envelope} opened</td><td>{at(o.at)} by {o.openedBy}, witness {o.witness || "-"}</td></tr>)}
      </tbody></table>

      <h2>2. Team</h2>
      <table className="items"><tbody>{p.team.map((t, i) => <tr key={i}><td>{t.role.replace(/_/g, " ")}</td><td>{t.email}</td></tr>)}</tbody></table>

      <h2>3. Evaluation basis</h2>
      {p.criteria ? <p>Technical criteria: {p.criteria.names.join("; ")}. Weights: {p.criteria.weights.technical}% technical, {p.criteria.weights.commercial}% commercial. Suggested pass mark {p.criteria.qualifyAt}/100.</p> : <p className="sub">Default settings applied.</p>}
      <table className="items"><thead><tr><th>Supplier</th><th className="num">Technical score</th><th>Result</th></tr></thead><tbody>{p.technical.map((t, i) => <tr key={i}><td>{t.name}</td><td className="num">{t.total}</td><td>{t.qualified ? "Qualified" : "Not qualified"}</td></tr>)}</tbody></table>

      <h2>4. Commercial ranking</h2>
      {p.comparison ? <table className="items"><thead><tr><th>#</th><th>Supplier</th><th className="num">Technical</th><th className="num">Total price</th><th className="num">Commercial</th><th className="num">Final</th></tr></thead><tbody>
        {p.comparison.rows.map((r) => <tr key={r.supplierId}><td>{r.rank}</td><td>{r.name}</td><td className="num">{r.tech}</td><td className="num">{r.total}</td><td className="num">{r.commercial}</td><td className="num">{r.final}</td></tr>)}</tbody></table> : <p className="sub">Not available to your role.</p>}

      <h2>5. Recommendation</h2>
      {p.recommendation ? <p><b>{p.recommendation.name}</b><br />{p.recommendation.note}</p> : <p className="sub">None recorded.</p>}

      <h2>6. Award approvals</h2>
      <table className="items"><tbody>{p.approvals.length ? p.approvals.map((a, i) => <tr key={i}><td>{a.email}</td><td>{a.decision}</td><td>{at(a.at)}</td></tr>) : <tr><td className="sub">None yet.</td></tr>}</tbody></table>

      <h2>7. Audit trail</h2>
      <table className="items"><thead><tr><th>When</th><th>Who</th><th>Action</th></tr></thead><tbody>{p.trail.map((t, i) => <tr key={i}><td>{at(t.at)}</td><td>{t.actor}</td><td>{t.action}</td></tr>)}</tbody></table>
    </div>
  );
}
