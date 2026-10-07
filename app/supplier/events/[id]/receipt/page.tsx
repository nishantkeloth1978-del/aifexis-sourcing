import { notFound, redirect } from "next/navigation";
import { getSupplierSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getBidForm } from "@/bids/service";
import { formatDec, parseDec } from "@/engine/decimal";
import PrintButton from "@/ui/PrintButton";

export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await getSupplierSession();
  if (!who) redirect("/no-access");
  const f = await getBidForm(getPool(), who, id);
  if (!f || !f.revisionNo || !f.fingerprint) notFound();
  const at = f.submittedAt ? new Date(f.submittedAt).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "medium", timeZone: "UTC" }) + " UTC" : "";
  return (
    <div className="pack">
      <div className="packbar"><a className="sublink" href={`/supplier/events/${id}`}>&larr; Back to your bid</a><PrintButton /></div>
      <h1>Bid receipt</h1>
      <p>{f.event.ref}: {f.event.title}</p>
      <table className="items"><tbody>
        <tr><th>Supplier</th><td>{who.supplierName}</td></tr>
        <tr><th>Revision</th><td>{f.revisionNo}</td></tr>
        <tr><th>Submitted</th><td>{at}</td></tr>
        <tr><th>Total</th><td>{f.event.currency} {formatDec(parseDec(f.total ?? "0", 2), 2)}</td></tr>
        <tr><th>Fingerprint</th><td><code>{f.fingerprint}</code></td></tr>
      </tbody></table>
      <h2>Prices submitted</h2>
      <table className="items"><thead><tr><th>#</th><th>Item</th><th className="num">Qty</th><th>Unit</th><th className="num">Unit price</th></tr></thead><tbody>
        {f.items.map((it) => <tr key={it.id}><td>{it.lineNo}</td><td>{it.description}</td><td className="num">{it.quantity}</td><td>{it.unit}</td><td className="num">{f.prices[it.id]}</td></tr>)}
      </tbody></table>
      {f.gates.length > 0 && (<><h2>Declarations</h2><table className="items"><tbody>{f.gates.map((g) => <tr key={g}><td>{g}</td><td>{f.gateAnswers[g] ? "Yes" : "No"}</td></tr>)}</tbody></table></>)}
      <p className="sub">The fingerprint identifies exactly what was submitted. Keep this receipt for your records. Revising your bid before the closing time creates a new revision and a new receipt.</p>
    </div>
  );
}
