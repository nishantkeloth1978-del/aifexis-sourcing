import { redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import ConfigForm from "@/ui/ConfigForm";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getConfig } from "@/config/service";
import { listTemplates } from "@/events/service";
import TemplateList from "@/ui/TemplateList";

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const [{ config, version }, templates] = await Promise.all([getConfig(getPool(), s), listTemplates(getPool(), s)]);
  return <Shell title="Configuration"><ConfigForm initial={config} version={version} canEdit={s.role === "admin"} /><TemplateList initial={templates} canDelete={s.role === "admin"} /></Shell>;
}
