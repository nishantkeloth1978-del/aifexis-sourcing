import { withinRate } from "@/lib/guard";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getEvent } from "@/events/service";
import { csvResponse, toCsv } from "@/export/csv";

export const dynamic = "force-dynamic";

/** The event's lines as CSV, in the same columns the import reads, so it can be edited and imported back. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return new Response("Not found", { status: 404 });
  if (!(await withinRate(s.membershipId, "exp", 30))) return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  const e = await getEvent(getPool(), s, id).catch(() => null);
  if (!e) return new Response("Not found", { status: 404 });
  const lot = (id: string | null) => { const l = e.lots.find((x) => x.id === id); return l ? l.name : ""; };
  const rows: (string | number)[][] = [
    ["Description", "Quantity", "Unit", "Type", "Lot", "Code", "Specification", "Required date", "Material group", "Target price"],
    ...e.items.map((i) => [i.description, i.quantity, i.unit, i.blockType === "LUMP_SUM" ? "Lump sum" : "Unit price", lot(i.lotId), i.code ?? "", i.specification ?? "", i.requiredDate ?? "", i.materialGroup ?? "", i.targetPrice ?? ""]),
  ];
  return csvResponse(`${e.ref}-items.csv`, toCsv(rows));
}
