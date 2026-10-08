import { redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import HandoverList from "@/ui/HandoverList";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listAwarded } from "@/handover/service";

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  return <Shell title="Integrations"><HandoverList rows={await listAwarded(getPool(), s)} /></Shell>;
}
