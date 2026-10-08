import { notFound, redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import Shell from "@/ui/Shell";
import CustomiseTemplate from "@/ui/CustomiseTemplate";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { listOverrides, previewEffective } from "@/templates/lifecycle";
import { activeConfig, listPolicies } from "@/templates/service";
import { lab } from "@/ui/lab";

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const pool = getPool();
  const p = /^[A-Z0-9_]{1,80}$/.test(key) ? await previewEffective(pool, s, key) : null;
  if (!p) notFound();
  const [overrides, policies, cfg] = await Promise.all([listOverrides(pool, s, key), listPolicies(pool, s), activeConfig(pool, s)]);
  const locked = policies.filter((x) => x.confirmed && x.kind !== "note").map((x) => `${x.kind === "require_document" ? "documents" : x.kind === "require_question" ? "questions" : "fields"}:${x.target}`);
  return <Shell title={lab(p.info.title, locale) || tx(locale, "Templates")}><CustomiseTemplate locale={locale} templateKey={key} version={p.version} effective={{ fields: p.effective.fields, questions: p.effective.questions, documents: p.effective.documents }} overrides={overrides} locked={locked} configVersion={cfg?.version ?? 0} canEdit={s.role === "admin"} /></Shell>;
}
