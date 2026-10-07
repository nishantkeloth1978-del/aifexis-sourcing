import { redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import ConfigForm from "@/ui/ConfigForm";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getConfig } from "@/config/service";

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const { config, version } = await getConfig(getPool(), s);
  return <Shell title="Configuration"><ConfigForm initial={config} version={version} canEdit={s.role === "admin"} /></Shell>;
}
