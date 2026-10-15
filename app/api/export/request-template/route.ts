import { getSession } from "@/lib/session";
import { csvResponse } from "@/export/csv";
import { TEMPLATE_CSV } from "@/requests/import";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getSession())) return new Response("Not found", { status: 404 });
  return csvResponse("request-import-template.csv", "﻿" + TEMPLATE_CSV);
}
