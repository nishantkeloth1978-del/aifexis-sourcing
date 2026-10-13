import { redirect } from "next/navigation";
import Shell from "@/ui/Shell";
import DecisionInbox from "@/ui/DecisionInbox";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { getLocale } from "@/i18n/server";
import { tx } from "@/i18n/tx";
import { inbox } from "@/decisions/service";

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const locale = await getLocale();
  const rows = await inbox(getPool(), s);
  return (
    <Shell title={tx(locale, "Confirmations")}>
      <p className="sub">{tx(locale, "Opening sealed envelopes, cancelling an event and starting a final round need a second person. Confirming takes a second factor, so only you can do it.")}</p>
      <DecisionInbox locale={locale} rows={rows} />
    </Shell>
  );
}
