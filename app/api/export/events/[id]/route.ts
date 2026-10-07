import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getCommercialView } from "@/commercial/service";
import { csvResponse, toCsv } from "@/export/csv";

export const dynamic = "force-dynamic";

/** The ranking table and price-by-line comparison, for those who may read the commercial results. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return new Response("Not found", { status: 404 });
  const v = await getCommercialView(getPool(), s, id).catch(() => null);
  if (!v?.comparison || !v.roles.some((r) => ["buyer", "comm_evaluator", "award_approver", "auditor"].includes(r))) return new Response("Not found", { status: 404 });
  const c = v.comparison;
  const rows: (string | number)[][] = [
    ["Ranking"], ["Rank", "Supplier", "Technical score", `Total price (${c.currency})`, "Commercial score", "Final score"],
    ...c.rows.map((r) => [r.rank, r.name, r.tech, r.total, r.commercial, r.final]),
    [], ["Price by line"], ["Line", "Item", "Quantity", "Unit", ...c.rows.flatMap((r) => [`${r.name} unit price`, `${r.name} amount`])],
    ...c.lines.map((l) => [l.lineNo, l.description, l.quantity, l.unit, ...c.rows.flatMap((r) => [l.byBid[r.supplierId]?.unitPrice ?? "", l.byBid[r.supplierId]?.amount ?? ""])]),
  ];
  return csvResponse(`comparison-${id.slice(0, 8)}.csv`, toCsv(rows));
}
