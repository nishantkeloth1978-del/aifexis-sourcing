import Shell from "@/ui/Shell";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import SecurityPanel from "./SecurityPanel";

export const metadata = { title: "Security | Aifexis Sourcing" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const locale = await getLocale();
  const sp = await searchParams;
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp?.[0] ?? null;
  return <Shell title={tx(locale, "Security")}><SecurityPanel locale={locale} enrolled={Boolean(factor)} factorId={factor?.id ?? null} required={process.env.REQUIRE_MFA === "true"} done={sp.done === "1"} /></Shell>;
}
